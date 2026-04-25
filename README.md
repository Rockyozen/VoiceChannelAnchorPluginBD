# VoiceChannelAnchor

A small BetterDiscord plugin that adds a button to bring your current voice channel back into view in the server channel list, without switching away from the text channel you are reading.

## Why

On large Discord servers, it is easy to lose track of the voice channel you are connected to while browsing text channels. Discord's native voice panel can jump you to the voice channel view, which also changes what is displayed in the main area.

VoiceChannelAnchor keeps your current text channel open and only scrolls the channel list on the left.

## Features

- Adds an `Anchor Voice Channel` button under Discord's connected voice panel.
- Keeps the currently opened text channel visible.
- Scrolls the server channel list to your active voice channel.
- Handles large channel lists by scanning Discord's virtualized channel list.
- Avoids Discord's native click behavior that switches the main view to the voice channel.

## Installation

1. Download `VoiceChannelAnchor.plugin.js`.
2. Move it into your BetterDiscord plugins folder.
3. Enable `VoiceChannelAnchor` in BetterDiscord settings.

Typical plugin folder on Windows:

```text
%APPDATA%\BetterDiscord\plugins
```

## Usage

Join a voice channel, keep browsing any text channel, then click `Anchor Voice Channel` in the voice connection panel. The left channel list will move to your active voice channel while the main Discord view stays where it was.

## Notes

This plugin depends on Discord's internal BetterDiscord/Webpack modules and DOM structure. If Discord changes the channel list implementation, the plugin may need an update.

## License

MIT
