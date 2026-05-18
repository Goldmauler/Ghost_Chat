# GhostChat Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Fix PowerShell (Windows Only)

If you get "running scripts is disabled" error:

```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Step 2: Build the Extension

```bash
cd Ghost_Chat
npm install
npm run compile
npx @vscode/vsce package
```

This creates `ghostchat-0.0.3.vsix`

### Step 3: Install in VS Code

**Option A: Via UI**
1. Open VS Code
2. Extensions view (Ctrl+Shift+X)
3. Click "..." menu → "Install from VSIX..."
4. Select `ghostchat-0.0.3.vsix`

**Option B: Via Command Line**
```bash
code --install-extension ghostchat-0.0.3.vsix
```

### Step 4: Configure Firewall (Required for Auto-Discovery)

**Windows**:
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "GhostChat UDP" -Direction Inbound -Protocol UDP -LocalPort 42818 -Action Allow
```

**Linux**:
```bash
sudo ufw allow 42818/udp
```

**macOS**:
- System Preferences → Security & Privacy → Firewall
- Firewall Options → Add VS Code or Node.js

### Step 5: Start Using

#### On First Machine (Host)

1. Open VS Code
2. GhostChat activates automatically
3. Choose **"Host on this computer"**
4. Done! Your machine is now broadcasting

#### On Other Machines (Clients)

1. Open VS Code
2. GhostChat activates automatically
3. Choose **"Connect to a host"**
4. **Automatic**: If one host found, connects instantly (zero-click!)
5. **Multiple hosts**: Choose from the list
6. Done! You're connected

### Step 6: Send Your First Message

1. Open any file
2. Select some text
3. Press **Ctrl+Shift+S**
4. Message sent!

### Step 7: Receive Messages

1. Place cursor anywhere
2. Press **Ctrl+Shift+V**
3. Full chat history appears as comments
4. Delete when done

## 🎯 That's It!

You're now using GhostChat with zero-configuration auto-discovery!

## 📊 Check Status

Look at the bottom-left status bar:

- `GhostChat • Group: TEAM-ALPHA (Host:42817)` - You're hosting
- `GhostChat • Group: TEAM-ALPHA (Conn:http://...)` - You're connected
- `GhostChat • Reconnecting... (3/120)` - Reconnecting

## 🐛 Troubleshooting

### No Hosts Found?

1. **Check firewall** - UDP port 42818 must be open
2. **Same network?** - All machines must be on same LAN
3. **Use manual mode** - Choose "Enter URL manually..." and paste host URL

### Connection Drops?

- GhostChat automatically reconnects for up to 10 minutes
- Check network stability
- Watch status bar for progress

### Port 42818 In Use?

```bash
# Windows
netstat -ano | findstr :42818

# Linux/macOS
lsof -i :42818
```

Stop the conflicting service or use manual connection.

## 📝 View Logs

1. View → Output
2. Select "GhostChat" from dropdown
3. All events are logged here

## 🔑 Keyboard Shortcuts

- **Ctrl+Shift+S** - Send selected text
- **Ctrl+Shift+V** - Insert history at cursor

## 📚 More Help

- **Full docs**: See [README.md](README.md)
- **Installation**: See [INSTALLATION.md](INSTALLATION.md)
- **Testing**: See [SETUP_AND_TEST_GUIDE.md](SETUP_AND_TEST_GUIDE.md)
- **Status**: See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)

## ✨ Pro Tips

1. **Zero-click connect**: If only one host is on your network, connection is automatic!
2. **Auto-reconnect**: Network hiccup? GhostChat reconnects automatically
3. **Multiple groups**: Create different groups for different topics
4. **File tracking**: Messages include file name and line number
5. **Debug logs**: Check Output panel if something goes wrong

**Happy chatting! 🎉**
