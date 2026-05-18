# GhostChat Installation Guide

## Prerequisites

Before installing GhostChat, ensure you have the following:

### Required Software

1. **VS Code** - Version 1.86.0 or higher
   - Download from: https://code.visualstudio.com/

2. **Node.js** - Version 18.0.0 or higher
   - Download from: https://nodejs.org/
   - Verify installation: `node -v`

3. **npm** - Usually comes with Node.js
   - Verify installation: `npm -v`

### Network Requirements

- **LAN Access**: All users must be on the same local network
- **Firewall Configuration**: 
  - Allow UDP port **42818** for auto-discovery
  - Allow the HTTP port used by the host (randomly assigned, typically 40000-65535)
  - On Windows: Add firewall rule for VS Code or Node.js
  - On macOS: System Preferences → Security & Privacy → Firewall → Firewall Options
  - On Linux: Configure iptables or ufw to allow the ports

## Installation Steps

### Option 1: Install from VSIX (Recommended for Testing)

1. **Download or Build the VSIX**
   ```bash
   cd Ghost_Chat
   npm install
   npm run compile
   npx @vscode/vsce package
   ```

2. **Install in VS Code**
   - Open VS Code
   - Go to Extensions view (Ctrl+Shift+X)
   - Click the "..." menu → "Install from VSIX..."
   - Select `ghostchat-0.0.3.vsix` (or latest version)

3. **Verify Installation**
   - Open Command Palette (Ctrl+Shift+P)
   - Type "GhostChat" - you should see all GhostChat commands

### Option 2: Install from Command Line

```bash
code --install-extension ghostchat-0.0.3.vsix
```

### Option 3: Development Mode

1. **Clone and Setup**
   ```bash
   cd Ghost_Chat
   npm install
   npm run compile
   ```

2. **Run in Development**
   - Open the project in VS Code
   - Press F5 to launch Extension Development Host
   - A new VS Code window opens with the extension loaded

## First-Time Setup

### Automatic Setup (Zero-Configuration)

1. **Start GhostChat** - The extension activates automatically when VS Code starts

2. **Choose Your Role**:
   - **Host on this computer** (Recommended) - Starts a host and broadcasts on LAN
   - **Connect to a host** - Automatically discovers hosts on your network
   - **Use shared file path** (Advanced) - For SMB/network share mode

3. **Auto-Discovery**:
   - If you choose "Host", your computer broadcasts its presence
   - If you choose "Connect", GhostChat automatically finds available hosts
   - If only one host is found, it connects automatically (zero-click!)
   - If multiple hosts are found, you choose from a list

4. **Create or Join a Group**:
   - Enter a group name (e.g., "TEAM-Alpha")
   - Or let GhostChat generate one for you

### Manual Setup (If Auto-Discovery Fails)

If UDP auto-discovery doesn't work (firewall issues, etc.):

1. **On Host Machine**:
   - Run `GhostChat: Start Host Share`
   - Note the URL shown (e.g., `http://192.168.1.100:42817`)
   - Share this URL with your team

2. **On Client Machines**:
   - Run `GhostChat: Connect to Host`
   - Choose "Enter URL manually..."
   - Paste the host URL

## Troubleshooting

### UDP Discovery Not Working

**Symptoms**: No hosts are discovered automatically

**Solutions**:
1. **Check Firewall**:
   ```bash
   # Windows (PowerShell as Administrator)
   New-NetFirewallRule -DisplayName "GhostChat UDP" -Direction Inbound -Protocol UDP -LocalPort 42818 -Action Allow
   
   # Linux (ufw)
   sudo ufw allow 42818/udp
   
   # macOS
   # System Preferences → Security & Privacy → Firewall → Firewall Options
   # Add VS Code or Node.js to allowed apps
   ```

2. **Verify Network**:
   - Ensure all machines are on the same LAN
   - Check if broadcast is allowed on your network
   - Some corporate networks block UDP broadcasts

3. **Use Manual Connection**:
   - Fall back to manual URL entry if auto-discovery fails

### Port 42818 Already in Use

**Symptoms**: Warning message "UDP discovery disabled (port 42818 in use)"

**Solutions**:
1. Check what's using the port:
   ```bash
   # Windows
   netstat -ano | findstr :42818
   
   # Linux/macOS
   lsof -i :42818
   ```

2. Stop the conflicting service or use manual connection mode

### Connection Keeps Dropping

**Symptoms**: "Reconnecting..." appears in status bar

**Solutions**:
1. **Check Network Stability**: Ensure stable LAN connection
2. **Check Host Status**: Verify the host machine is still running
3. **Firewall Issues**: Host firewall might be blocking connections
4. **Wait for Auto-Reconnect**: GhostChat automatically reconnects for up to 10 minutes

### PowerShell Execution Policy Error

**Symptoms**: `npm` commands fail with "running scripts is disabled"

**Solution**:
```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### No Groups Found

**Symptoms**: "No groups found in the shared GhostChat file yet"

**Solutions**:
1. Create a new group: `GhostChat: Create New Group`
2. Ask a teammate to send a message first
3. Verify you're connected to the correct host

## Verification Checklist

After installation, verify everything works:

- [ ] Extension appears in Extensions view
- [ ] GhostChat commands appear in Command Palette
- [ ] Status bar shows "GhostChat • No Group" or "GhostChat • Group: [name]"
- [ ] Can start host share successfully
- [ ] Can discover hosts automatically (or connect manually)
- [ ] Can create/join groups
- [ ] Can send selected text (Ctrl+Shift+S)
- [ ] Can insert history (Ctrl+Shift+V)
- [ ] Messages sync between machines

## Debugging

### Enable Debug Logging

1. Open Output panel: View → Output
2. Select "GhostChat" from the dropdown
3. All discovery events, errors, and connection attempts are logged here

### Common Log Messages

- `Discovery listener started on port 42818` - UDP listener is working
- `Discovered host: http://...` - Found a host on the network
- `Pruned stale host: ...` - Removed inactive host
- `UDP discovery disabled: port 42818 is already in use` - Port conflict
- `Connection lost, starting reconnection attempts` - Network issue detected
- `Reconnection successful` - Connection restored

## Uninstallation

1. **Remove Extension**:
   - Go to Extensions view
   - Find GhostChat
   - Click Uninstall

2. **Clean Up Data** (Optional):
   - Workspace state is stored in VS Code's workspace storage
   - History files are in the configured shared path or VS Code's global storage
   - No system-wide changes are made

## Getting Help

If you encounter issues:

1. Check the Output panel (View → Output → GhostChat)
2. Review this troubleshooting guide
3. Check firewall and network settings
4. Try manual connection mode as a fallback
5. Verify all prerequisites are met

## Next Steps

After successful installation:

1. Read [README.md](README.md) for usage instructions
2. Review [SETUP_AND_TEST_GUIDE.md](SETUP_AND_TEST_GUIDE.md) for testing procedures
3. Start using GhostChat with your team!

## Minimum System Requirements

- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **VS Code**: 1.86.0 or higher
- **Node.js**: 18.0.0 or higher
- **RAM**: 4GB minimum (8GB recommended)
- **Network**: LAN access with UDP broadcast support
- **Disk Space**: ~50MB for extension and dependencies

## Security Notes

- GhostChat operates entirely on your local network
- No data is sent to external servers
- UDP broadcasts are limited to your LAN segment
- HTTP connections are unencrypted (LAN trust model)
- Consider using VPN if connecting across untrusted networks
