/**
 * @name VoiceChannelAnchor
 * @author Rockyozen
 * @description Adds a button to anchor your current voice channel in the channel list without changing your active text channel.
 * @version 1.0.1
 * @website https://github.com/Rockyozen/VoiceChannelAnchorPluginBD
 * @source https://github.com/Rockyozen/VoiceChannelAnchorPluginBD/blob/main/VoiceChannelAnchor.plugin.js
 */

"use strict";

const {Webpack, DOM, UI} = BdApi;

const SelectedChannelStore = Webpack.getStore("SelectedChannelStore");
const SelectedGuildStore = Webpack.getStore("SelectedGuildStore");
const ChannelStore = Webpack.getStore("ChannelStore");
const GuildChannelStore = Webpack.getStore("GuildChannelStore");
const panelContainerClasses = Webpack.getByKeys("connection", "inner", "channel");
const channelListClasses = Webpack.getByKeys("containerDefault", "mainContent", "name", "unread");
const sidebarClasses = Webpack.getByKeys("sidebar", "hasNotice");
const scrollerClasses = Webpack.getByKeys("thin", "scrollerBase", "content");

module.exports = class VoiceChannelAnchor {
    constructor() {
        this.pendingRetry = null;
        this.flashTimeout = null;
        this.observer = null;
        this.refreshInterval = null;
        this.scanState = null;
        this.hostId = "voiceChannelAnchorHost";
    }

    start() {
        if (!SelectedChannelStore?.getVoiceChannelId || !ChannelStore?.getChannel || !panelContainerClasses?.connection) {
            BdApi.Logger.error("VoiceChannelAnchor", "Unable to load the required Discord modules.");
            return;
        }

        DOM.addStyle("VoiceChannelAnchor", `
            #voiceChannelAnchorHost {
                padding: 0 8px 8px;
                display: flex;
                justify-content: center;
                pointer-events: auto;
            }

            #voiceChannelAnchorHost .voiceChannelAnchorButton {
                width: 100%;
                border: 0;
                border-radius: 8px;
                padding: 7px 10px;
                font-size: 12px;
                font-weight: 700;
                line-height: 1.2;
                cursor: pointer;
                color: var(--white-500);
                background: var(--button-secondary-background, var(--background-modifier-accent));
                transition: background 0.15s ease, transform 0.15s ease;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
            }

            #voiceChannelAnchorHost .voiceChannelAnchorButton:hover {
                background: var(--button-secondary-background-hover, var(--background-modifier-hover));
            }

            #voiceChannelAnchorHost .voiceChannelAnchorButton:active {
                transform: translateY(1px);
            }

            .voiceChannelAnchorFlash {
                animation: voiceChannelAnchorFlash 1.2s ease;
            }

            @keyframes voiceChannelAnchorFlash {
                0% {
                    background-color: var(--brand-500, rgba(88, 101, 242, 0.65));
                }
                100% {
                    background-color: transparent;
                }
            }
        `);

        this.observer = new MutationObserver(() => this.ensureButtonMounted());
        this.observer.observe(document.body, {childList: true, subtree: true});

        this.refreshInterval = setInterval(() => this.ensureButtonMounted(), 1500);

        this.ensureButtonMounted();
    }

    stop() {
        if (this.pendingRetry) {
            clearTimeout(this.pendingRetry);
            this.pendingRetry = null;
        }

        if (this.flashTimeout) {
            clearTimeout(this.flashTimeout);
            this.flashTimeout = null;
        }

        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        this.scanState = null;
        this.removeButton();
        DOM.removeStyle("VoiceChannelAnchor");
    }

    ensureButtonMounted() {
        const host = document.getElementById(this.hostId);
        const voiceChannel = this.getVoiceChannel();
        const voicePanel = this.getVoicePanelElement();

        if (!voiceChannel || !voicePanel) {
            this.removeButton();
            return;
        }

        if (host?.previousElementSibling !== voicePanel) {
            this.removeButton();
        }

        if (document.getElementById(this.hostId)) {
            return;
        }

        const buttonHost = document.createElement("div");
        buttonHost.id = this.hostId;

        const button = document.createElement("button");
        button.className = "voiceChannelAnchorButton";
        button.type = "button";
        button.textContent = "Anchor Voice Channel";

        const swallowEvent = event => {
            event.preventDefault();
            event.stopPropagation();
        };

        button.addEventListener("mousedown", swallowEvent);
        button.addEventListener("mouseup", swallowEvent);
        button.addEventListener("click", event => {
            swallowEvent(event);
            this.centerCurrentVoiceChannel();
        });

        buttonHost.addEventListener("mousedown", event => event.stopPropagation());
        buttonHost.addEventListener("click", event => event.stopPropagation());
        buttonHost.appendChild(button);

        voicePanel.insertAdjacentElement("afterend", buttonHost);
    }

    removeButton() {
        document.getElementById(this.hostId)?.remove();
    }

    getVoicePanelElement() {
        const className = panelContainerClasses?.connection;
        if (!className) {
            return null;
        }

        const selector = this.toClassSelector(className);
        return selector ? document.querySelector(selector) : null;
    }

    toClassSelector(className) {
        const parts = String(className)
            .split(/\s+/)
            .filter(Boolean)
            .map(part => `.${CSS.escape(part)}`);

        return parts.length ? parts.join("") : null;
    }

    centerCurrentVoiceChannel() {
        const voiceChannel = this.getVoiceChannel();
        if (!voiceChannel) {
            UI.showToast("No active voice channel.", {type: "error"});
            return;
        }

        const selectedGuildId = SelectedGuildStore?.getGuildId?.();
        const voiceGuildId = voiceChannel.guild_id ?? voiceChannel.guildId;
        if (selectedGuildId !== voiceGuildId) {
            UI.showToast("Your active voice channel is on another server. Open that server first.", {type: "error"});
            return;
        }

        this.scanState = null;
        const sidebarRoot = this.getGuildSidebarRoot(voiceGuildId);
        const scroller = this.getChannelListScroller(sidebarRoot);

        if (!sidebarRoot || !scroller) {
            UI.showToast("Unable to locate Discord's channel list.", {type: "error"});
            return;
        }

        this.tryScrollToChannel(voiceChannel, 28);
    }

    tryScrollToChannel(channel, remainingAttempts) {
        if (this.pendingRetry) {
            clearTimeout(this.pendingRetry);
            this.pendingRetry = null;
        }

        const target = this.findChannelElement(channel);
        if (target) {
            this.scrollChannelIntoPreferredPosition(target);
            UI.showToast("Voice channel anchored.", {type: "success"});

            target.classList.add("voiceChannelAnchorFlash");

            if (this.flashTimeout) {
                clearTimeout(this.flashTimeout);
            }

            this.flashTimeout = setTimeout(() => {
                target.classList.remove("voiceChannelAnchorFlash");
                this.flashTimeout = null;
            }, 1200);

            return;
        }

        if (remainingAttempts <= 0) {
            UI.showToast("Unable to find the voice channel in the channel list.", {type: "error"});
            return;
        }

        if (this.scrollVirtualizedChannelIntoView(channel)) {
            this.pendingRetry = setTimeout(() => {
                this.pendingRetry = null;
                this.tryScrollToChannel(channel, remainingAttempts - 1);
            }, 60);
            return;
        }

        this.pendingRetry = setTimeout(() => {
            this.pendingRetry = null;
            this.tryScrollToChannel(channel, remainingAttempts - 1);
        }, 200);
    }

    getVoiceChannel() {
        const voiceChannelId = SelectedChannelStore?.getVoiceChannelId?.();
        if (!voiceChannelId) {
            return null;
        }

        return ChannelStore?.getChannel?.(voiceChannelId) ?? null;
    }

    findChannelElement(channel) {
        const guildId = channel.guild_id ?? channel.guildId;
        const channelId = channel.id;
        const channelName = String(channel.name ?? "").trim();
        const sidebarRoot = this.getGuildSidebarRoot(guildId);

        if (!sidebarRoot) {
            return null;
        }

        const selectors = [
            `[data-list-item-id="channels___${channelId}"]`,
            `[data-list-item-id*="channels___${channelId}"]`,
            `a[href="/channels/${guildId}/${channelId}"]`,
            `[href="/channels/${guildId}/${channelId}"]`
        ];

        for (const selector of selectors) {
            const match = sidebarRoot.querySelector(selector);
            if (match && this.isInsideChannelList(match)) {
                return this.normalizeChannelElement(match);
            }
        }

        const candidates = sidebarRoot.querySelectorAll('[data-list-item-id*="channels___"], a[href^="/channels/"], [role="treeitem"], [aria-label]');

        for (const candidate of candidates) {
            const channelElement = this.normalizeChannelElement(candidate);
            if (!channelElement || !this.isInsideChannelList(channelElement)) {
                continue;
            }

            if (this.elementMatchesChannel(channelElement, guildId, channelId)) {
                return channelElement;
            }
        }

        const textMatch = this.findChannelElementByName(sidebarRoot, channelName);
        if (textMatch) {
            return textMatch;
        }

        return null;
    }

    normalizeChannelElement(element) {
        return element.closest?.('[data-list-item-id*="channels___"]')
            || element.closest?.('a[href^="/channels/"]')
            || element.closest?.('[role="treeitem"]')
            || element;
    }

    elementMatchesChannel(element, guildId, channelId) {
        const listItem = element.matches?.('[data-list-item-id*="channels___"]')
            ? element
            : element.querySelector?.('[data-list-item-id*="channels___"]');
        const listItemId = listItem?.getAttribute?.("data-list-item-id") ?? "";

        if (listItemId.includes(channelId)) {
            return true;
        }

        const expectedHref = `/channels/${guildId}/${channelId}`;
        const link = element.matches?.(`a[href="${expectedHref}"]`)
            ? element
            : element.querySelector?.(`a[href="${expectedHref}"]`);

        return Boolean(link);
    }

    findChannelElementByName(sidebarRoot, channelName) {
        if (!channelName) {
            return null;
        }

        const searchRoots = [
            ...sidebarRoot.querySelectorAll('[data-list-item-id*="channels___"]'),
            ...sidebarRoot.querySelectorAll('[role="treeitem"]'),
            ...sidebarRoot.querySelectorAll('[aria-label]')
        ];

        for (const node of searchRoots) {
            const text = node.textContent?.replace(/\s+/g, " ").trim();
            if (!text) {
                continue;
            }

            if (text === channelName || text.startsWith(channelName) || text.includes(` ${channelName}`) || text.includes(channelName)) {
                const normalized = this.normalizeChannelElement(node);
                if (normalized && this.isInsideChannelList(normalized)) {
                    return normalized;
                }
            }
        }

        return null;
    }

    scrollChannelIntoPreferredPosition(target) {
        const sidebarRoot = this.getGuildSidebarRoot();
        const scrollParent = this.getChannelScroller(target, sidebarRoot);
        if (!scrollParent) {
            target.scrollIntoView({
                behavior: "instant",
                block: "center",
                inline: "nearest"
            });
            return;
        }

        target.scrollIntoView({
            behavior: "instant",
            block: "start",
            inline: "nearest"
        });

        const parentRect = scrollParent.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const currentScrollTop = scrollParent.scrollTop;
        const preferredTopOffset = Math.max(72, parentRect.height * 0.22);
        const nextScrollTop = currentScrollTop + (targetRect.top - parentRect.top) - preferredTopOffset;

        window.setTimeout(() => {
            const top = Math.max(0, nextScrollTop);

            this.setScrollTopInstant(scrollParent, top);

            let ancestor = scrollParent.parentElement;
            while (ancestor && ancestor !== sidebarRoot?.parentElement) {
                if (this.isScrollable(ancestor) && ancestor.contains(target)) {
                    this.setScrollTopInstant(ancestor, top);
                }

                ancestor = ancestor.parentElement;
            }
        }, 40);
    }

    scrollVirtualizedChannelIntoView(channel) {
        const sidebarRoot = this.getGuildSidebarRoot();
        const scrollers = this.getSidebarScrollers(sidebarRoot);
        const orderedChannels = this.getOrderedGuildChannels(channel.guild_id ?? channel.guildId);
        const channelIndex = orderedChannels.findIndex(item => item?.id === channel.id);

        if (!scrollers.length) {
            return false;
        }

        const top = this.getNextSearchScrollTop(channel, scrollers, orderedChannels, channelIndex);
        if (top === null) {
            return false;
        }

        for (const scroller of scrollers) {
            this.setScrollTopInstant(scroller, top);
        }

        return true;
    }

    getNextSearchScrollTop(channel, scrollers, orderedChannels, channelIndex) {
        const primaryScroller = scrollers.reduce((best, scroller) => {
            if (!best) {
                return scroller;
            }

            return scroller.scrollHeight > best.scrollHeight ? scroller : best;
        }, null);

        if (!primaryScroller) {
            return null;
        }

        const channelId = channel.id;
        if (!this.scanState || this.scanState.channelId !== channelId) {
            this.scanState = {
                channelId,
                index: 0,
                positions: this.buildSearchPositions(primaryScroller, orderedChannels, channelIndex)
            };
        }

        if (this.scanState.index >= this.scanState.positions.length) {
            return null;
        }

        const top = this.scanState.positions[this.scanState.index];
        this.scanState.index += 1;

        return top;
    }

    buildSearchPositions(scroller, orderedChannels, channelIndex) {
        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const step = Math.max(420, Math.floor(scroller.clientHeight * 1.35));
        const positions = [];
        const add = top => {
            const normalized = Math.max(0, Math.min(maxTop, Math.round(top)));
            if (!positions.some(value => Math.abs(value - normalized) < 24)) {
                positions.push(normalized);
            }
        };

        const currentTop = scroller.scrollTop;
        add(currentTop);

        const nearBottom = currentTop > maxTop - (step * 0.75);

        if (nearBottom) {
            if (channelIndex >= 0) {
                const visibleRows = this.getVisibleChannelRows(this.getGuildSidebarRoot());
                const rowHeight = this.getEstimatedRowHeight(visibleRows);
                const estimatedTop = (channelIndex * rowHeight) - (scroller.clientHeight * 0.22);

                if (estimatedTop > maxTop * 0.55) {
                    add(estimatedTop);
                    add(estimatedTop - Math.floor(step * 0.35));
                    add(estimatedTop + Math.floor(step * 0.35));
                }
            }

            this.addBottomFirstSearchPositions(positions, add, currentTop, step, maxTop);

            return positions;
        }

        if (channelIndex >= 0) {
            const visibleRows = this.getVisibleChannelRows(this.getGuildSidebarRoot());
            const rowHeight = this.getEstimatedRowHeight(visibleRows);
            const estimatedTop = (channelIndex * rowHeight) - (scroller.clientHeight * 0.22);
            this.addEstimatedSearchPositions(positions, add, currentTop, estimatedTop, step, maxTop);
            return positions;
        }

        this.addFocusedSearchPositions(positions, add, currentTop, maxTop, step, maxTop);
        add(maxTop);

        return positions;
    }

    addBottomFirstSearchPositions(positions, add, currentTop, step, maxTop) {
        add(maxTop);
        add(maxTop - Math.floor(step * 0.55));
        add(currentTop);

        for (let top = maxTop - step; top >= 0; top -= step) {
            add(top);
        }
    }

    addEstimatedSearchPositions(positions, add, currentTop, estimatedTop, step, maxTop) {
        const clampedTarget = Math.max(0, Math.min(maxTop, estimatedTop));
        add(clampedTarget);
        add(clampedTarget - Math.floor(step * 0.35));
        add(clampedTarget + Math.floor(step * 0.35));
        add(clampedTarget - step);
        add(clampedTarget + step);

        const direction = clampedTarget >= currentTop ? 1 : -1;
        if (direction > 0) {
            for (let top = clampedTarget + (step * 2); top <= maxTop; top += step) {
                add(top);
            }

            for (let top = clampedTarget - (step * 2); top >= 0; top -= step) {
                add(top);
            }
        }
        else {
            for (let top = clampedTarget - (step * 2); top >= 0; top -= step) {
                add(top);
            }

            for (let top = clampedTarget + (step * 2); top <= maxTop; top += step) {
                add(top);
            }
        }
    }

    addFocusedSearchPositions(positions, add, currentTop, targetTop, step, maxTop) {
        const clampedTarget = Math.max(0, Math.min(maxTop, targetTop));
        const nearBottom = currentTop > maxTop - (step * 0.75);
        const direction = clampedTarget >= currentTop ? 1 : -1;

        add(clampedTarget);
        add(clampedTarget - Math.floor(step * 0.45));
        add(clampedTarget + Math.floor(step * 0.45));

        if (nearBottom) {
            add(maxTop);
            add(maxTop - Math.floor(step * 0.45));
            add(maxTop - step);
        }

        if (direction > 0) {
            for (let top = Math.max(currentTop, clampedTarget) + step; top <= maxTop; top += step) {
                add(top);
            }

            add(maxTop);

            for (let top = Math.min(currentTop, clampedTarget) - step; top >= 0; top -= step) {
                add(top);
            }
        }
        else {
            for (let top = Math.min(currentTop, clampedTarget) - step; top >= 0; top -= step) {
                add(top);
            }

            if (!nearBottom) {
                add(0);
            }

            for (let top = Math.max(currentTop, clampedTarget) + step; top <= maxTop; top += step) {
                add(top);
            }

            add(maxTop);
        }
    }

    getOrderedGuildChannels(guildId) {
        const guildChannels = GuildChannelStore?.getChannels?.(guildId);
        const channels = [];
        const seen = new Set();
        const visitedObjects = new WeakSet();

        const visit = value => {
            if (!value || typeof value !== "object") {
                return;
            }

            if (visitedObjects.has(value)) {
                return;
            }

            visitedObjects.add(value);

            if (Array.isArray(value)) {
                for (const item of value) {
                    visit(item);
                }
                return;
            }

            const channel = value.channel ?? value;
            if (channel?.id && !seen.has(channel.id)) {
                seen.add(channel.id);
                channels.push(channel);
            }

            for (const child of Object.values(value)) {
                if (child !== channel) {
                    visit(child);
                }
            }
        };

        visit(guildChannels);

        return channels.filter(channel => channel?.id && channel.guild_id !== null);
    }

    getVisibleChannelRows(sidebarRoot) {
        if (!sidebarRoot) {
            return [];
        }

        return [...sidebarRoot.querySelectorAll('[data-list-item-id*="channels___"], a[href^="/channels/"], [role="treeitem"]')]
            .filter(node => this.isInsideChannelList(node));
    }

    getEstimatedRowHeight(rows) {
        const heights = rows
            .map(row => row.getBoundingClientRect().height)
            .filter(height => height >= 20 && height <= 80);

        if (!heights.length) {
            return 34;
        }

        return heights.reduce((sum, height) => sum + height, 0) / heights.length;
    }

    getGuildSidebarRoot(guildId = SelectedGuildStore?.getGuildId?.()) {
        const semanticRoot = this.getSemanticChannelListRoot(guildId);
        if (semanticRoot) {
            return semanticRoot;
        }

        const voicePanel = this.getVoicePanelElement();
        const fromVoicePanel = this.getGuildSidebarRootFromVoicePanel(voicePanel);
        if (fromVoicePanel) {
            return fromVoicePanel;
        }

        const detectedRoot = this.getGuildSidebarRootByChannelLinks(guildId);
        if (detectedRoot) {
            return detectedRoot;
        }

        const sidebarSelector = this.toClassSelector(sidebarClasses?.sidebar);
        const sidebar = sidebarSelector ? document.querySelector(sidebarSelector) : null;
        if (sidebar?.querySelector?.('[data-list-item-id*="channels___"], a[href^="/channels/"]')) {
            return sidebar;
        }

        const fallback = document.querySelector('[data-list-item-id*="channels___"], a[href^="/channels/"]')?.closest?.('[class*="sidebar"]')
            || document.querySelector('[data-list-item-id*="channels___"], a[href^="/channels/"]')?.parentElement;

        return fallback ?? null;
    }

    getSemanticChannelListRoot(guildId) {
        const selectors = [
            'nav[aria-label]',
            '[aria-label*="Channels"]',
            '[aria-label*="channels"]',
            '[aria-label*="Salons"]',
            '[aria-label*="salons"]',
            '[data-list-id*="channels"]',
            '[data-list-id*="guildsnav"]'
        ];
        const candidates = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);

        return candidates
            .filter(candidate => this.looksLikeChannelListRoot(candidate, guildId))
            .sort((a, b) => this.scoreChannelListRoot(b, guildId) - this.scoreChannelListRoot(a, guildId))[0] ?? null;
    }

    looksLikeChannelListRoot(element, guildId) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect || this.isInServerRail(element)) {
            return false;
        }

        if (rect.width < 160 || rect.width > 520 || rect.height < 220 || rect.left > 520) {
            return false;
        }

        return this.scoreChannelListRoot(element, guildId) > 0;
    }

    scoreChannelListRoot(element, guildId) {
        const channelSelector = guildId
            ? `[data-list-item-id*="channels___"], a[href^="/channels/${guildId}/"]`
            : '[data-list-item-id*="channels___"], a[href^="/channels/"]';
        const channelCount = element.querySelectorAll(channelSelector).length;
        const serverCount = element.querySelectorAll('[data-list-item-id*="guildsnav"], [aria-label*="server"], [aria-label*="Server"]').length;

        return channelCount - serverCount;
    }

    getGuildSidebarRootFromVoicePanel(voicePanel) {
        let current = voicePanel?.parentElement ?? null;

        while (current && current !== document.body) {
            if (current.querySelector?.('[data-list-item-id*="channels___"], a[href^="/channels/"]')) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    getGuildSidebarRootByChannelLinks(guildId) {
        if (!guildId) {
            return null;
        }

        const voicePanel = this.getVoicePanelElement();
        const buttonHost = document.getElementById(this.hostId);
        const channelNodes = [...document.querySelectorAll(`[data-list-item-id*="channels___"], a[href^="/channels/${guildId}/"]`)]
            .filter(node => {
                const rect = node.getBoundingClientRect?.();
                return rect
                  && !this.isInServerRail(node)
                    && rect.right < 520
                    && !voicePanel?.contains(node)
                    && !buttonHost?.contains(node);
            });
        const roots = new Map();

        for (const node of channelNodes) {
            let current = node;

            while (current && current !== document.body) {
                const rect = current.getBoundingClientRect?.();
                if (rect && !this.isInServerRail(current) && rect.width >= 160 && rect.width <= 520 && rect.height >= 260) {
                    const count = current.querySelectorAll(`[data-list-item-id*="channels___"], a[href^="/channels/${guildId}/"]`).length;
                    const currentScore = roots.get(current) ?? 0;
                    roots.set(current, Math.max(currentScore, count));
                }

                current = current.parentElement;
            }
        }

        return [...roots.entries()]
            .filter(([, count]) => count >= 2)
            .sort(([rootA, countA], [rootB, countB]) => {
                if (countA !== countB) {
                    return countB - countA;
                }

                const areaA = rootA.getBoundingClientRect().width * rootA.getBoundingClientRect().height;
                const areaB = rootB.getBoundingClientRect().width * rootB.getBoundingClientRect().height;
                return areaA - areaB;
            })
            .map(([root]) => root)
            .find(root => root.querySelector?.(`[data-list-item-id*="channels___"], a[href^="/channels/${guildId}/"]`)) ?? null;
    }

    getChannelScroller(target, sidebarRoot) {
        if (!sidebarRoot) {
            return this.getScrollParent(target);
        }

        const listScroller = this.getChannelListScroller(sidebarRoot);
        if (listScroller?.contains(target)) {
            return listScroller;
        }

        const preferredSelectors = [
            this.toClassSelector(scrollerClasses?.scrollerBase),
            this.toClassSelector(scrollerClasses?.content),
            this.toClassSelector(channelListClasses?.scroller),
            '[role="tree"]'
        ].filter(Boolean);

        for (const selector of preferredSelectors) {
            const nodes = sidebarRoot.querySelectorAll(selector);
            for (const node of nodes) {
                if (node.contains(target) && this.isScrollable(node)) {
                    return node;
                }
            }
        }

        return this.getScrollParent(target);
    }

    getChannelListScroller(sidebarRoot) {
        if (!sidebarRoot) {
            return null;
        }

        const classSelectors = [
            this.toClassSelector(scrollerClasses?.scrollerBase),
            this.toClassSelector(scrollerClasses?.thin),
            this.toClassSelector(scrollerClasses?.content),
            this.toClassSelector(channelListClasses?.scroller)
        ].filter(Boolean);

        const candidates = [
            ...sidebarRoot.querySelectorAll('[data-list-id*="channels"], [role="tree"], nav[aria-label], [aria-label*="Channels"], [aria-label*="channels"], [aria-label*="Salons"], [aria-label*="salons"]'),
            ...classSelectors.flatMap(selector => [...sidebarRoot.querySelectorAll(selector)]),
            sidebarRoot
        ];

        for (const candidate of candidates) {
            if (!this.isInServerRail(candidate) && this.isScrollable(candidate) && candidate.querySelector?.('[data-list-item-id*="channels___"], a[href^="/channels/"], [role="treeitem"]')) {
                return candidate;
            }
        }

        return null;
    }

    getSidebarScrollers(sidebarRoot) {
        if (!sidebarRoot) {
            return [];
        }

        const primary = this.getChannelListScroller(sidebarRoot);
        return primary ? [primary] : [];
    }

    isInsideChannelList(element) {
        if (!element) {
            return false;
        }

        const voicePanel = this.getVoicePanelElement();
        const buttonHost = document.getElementById(this.hostId);

        if (voicePanel?.contains(element) || buttonHost?.contains(element)) {
            return false;
        }

        const scroller = this.getChannelListScroller(this.getGuildSidebarRoot());
        return scroller ? scroller.contains(element) : true;
    }

    getScrollParent(element) {
        let current = element?.parentElement ?? null;

        while (current) {
            if (this.isScrollable(current)) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    isScrollable(element) {
        if (!element) {
            return false;
        }

        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY;
        return (overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight;
    }

    isInServerRail(element) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect) {
            return true;
        }

        return rect.right <= 110 || rect.width < 80;
    }

    setScrollTopInstant(element, top) {
        const previousScrollBehavior = element.style.scrollBehavior;
        element.style.scrollBehavior = "auto";
        element.scrollTop = Math.max(0, top);
        element.style.scrollBehavior = previousScrollBehavior;
    }
};
