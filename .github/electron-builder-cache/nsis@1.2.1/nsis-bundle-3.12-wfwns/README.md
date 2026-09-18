# NSIS Cross-Platform Bundle

This bundle contains NSIS (Nullsoft Scriptable Install System) binaries for multiple platforms.

## Contents

- **Windows**: `windows/makensis.exe` (official pre-built binary)
- **Linux**: `linux/x64/makensis` and `linux/arm64/makensis` (native ELF binaries, compiled from source)
- **macOS**: `mac/makensis` (native Mach-O binary, compiled from source)
- **Elevate**: `elevate.exe` (Windows privilege elevation utility, compiled from source)
- **NSIS Data**: `windows/` (Contrib, Include, Plugins, Stubs)
- **Universal Wrapper**: `makensis` (auto-detects platform, sets `NSISDIR`) [.cmd and .ps1 versions for Windows]

## Quick Start

### Option 1: Use Universal Wrapper (Recommended)

The wrapper automatically detects your platform and sets `NSISDIR`:

```bash
# Linux/macOS/Git Bash
./makensis your-script.nsi

# Windows CMD
makensis.cmd your-script.nsi

# Windows PowerShell
.\makensis.ps1 your-script.nsi
```

### Option 2: Use Platform-Specific Binary

```bash
# Set NSISDIR manually
export NSISDIR="$(pwd)/windows"

# Run platform-specific binary
./windows/makensis.exe your-script.nsi  # Windows
./linux/x64/makensis your-script.nsi     # Linux x64
./linux/arm64/makensis your-script.nsi   # Linux arm64
./mac/makensis your-script.nsi           # macOS
```

## Version Information

- NSIS Version: 3.12
- Branch/Tag: v312
- Build Date: 2026-05-23T15:28:54Z

## Included Plugins

This bundle includes 10 additional community plugins:

1. INetC - HTTP/HTTPS download plugin
2. StdUtils - Standard utilities (strings, math, system)
3. SpiderBanner - Animated splash/banner
4. NsProcess - Process management (list, kill)
5. UAC - User Account Control elevation
6. WinShell - Shell integration (file associations, shortcuts)
7. EmbedHTML - Embed HTML pages in installer
8. Nsisunz - ZIP extraction (ANSI)
9. NSISunzU - ZIP extraction (Unicode)
10. nsis7z - 7-Zip extraction

## Environment Variables

- **NSISDIR**: Path to NSIS data directory (auto-set by wrapper)
- Set manually if needed: `export NSISDIR=/path/to/windows`

## More Information

- NSIS Documentation: https://nsis.sourceforge.io/Docs/
- Plugin Repository: https://nsis.sourceforge.io/Category:Plugins
