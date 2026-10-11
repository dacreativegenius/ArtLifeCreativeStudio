# Art Life Creative Studio
A cross-platform drawing and illustration app built for touch screens and stylus. It runs on the web, Windows (portable .exe) and Android (.apk).

## Features
- Pencil, Pressure Ink, Mono Line vector brush, vector eraser
- Hold to shape: hold the pen still for 1 second to snap to a line, circle or rectangle
- Pen tool with one-sided handles, continuing open paths, joining anchors (Ctrl+J)
- Multi-select without a keyboard, nested layers, merge pencil layer down
- Stylus support for Wacom, Surface Pen, S Pen and Apple Pencil
- .dtm project files that work on every platform, plus PNG and SVG export
- Built-in Guide (top bar) that you can save as a PDF

## Run the web version
pnpm install pnpm --filter @vibe/app-vite dev

## Build the Windows .exe
cd apps/vite/electron npm install npm run portable

## Build the Android APK
cd apps/vite/android-app pnpm install pnpm run apk

## License
MIT