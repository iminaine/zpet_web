// VPet Device Manager - UI Controller

class VPetUIManager {
  constructor() {
    this.manager = new VPetManager();
    this.firmware = null;
    this.firmwareVersions = [
      { version: '2.0.0', file: 'firmware/vpet-v2.0.0.bin', date: '2026-01-15' },
      { version: '1.9.5', file: 'firmware/vpet-v1.9.5.bin', date: '2025-12-20' },
      { version: '1.9.0', file: 'firmware/vpet-v1.9.0.bin', date: '2025-11-10' }
    ];
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Connection
    document.getElementById('connect').addEventListener('click', () => this.handleConnect());
    document.getElementById('disconnect').addEventListener('click', () => this.handleDisconnect());

    // Pet Management
    document.getElementById('savePetName').addEventListener('click', () => this.handleSavePetName());
    document.getElementById('saveOwnerName').addEventListener('click', () => this.handleSaveOwnerName());
    document.getElementById('backupBtn').addEventListener('click', () => this.handleBackup());
    document.getElementById('restoreBtn').addEventListener('click', () => this.handleRestore());
    document.getElementById('restoreFile').addEventListener('change', (e) => this.handleRestoreFile(e));

    // Events
    document.getElementById('refreshEvents').addEventListener('click', () => this.handleRefreshEvents());

    // Firmware
    document.getElementById('updateBtn').addEventListener('click', () => this.handleFirmwareUpdate());
    document.getElementById('firmwareFile').addEventListener('change', (e) => this.handleFirmwareSelect(e));
    document.getElementById('firmwareSelect').addEventListener('change', (e) => this.handleVersionSelect(e));

    // Listen for firmware progress updates
    window.addEventListener('firmwareProgress', (e) => this.updateProgress(e.detail.progress));

    // Populate firmware versions
    this.populateFirmwareVersions();
  }

  async handleConnect() {
    try {
      document.getElementById('connect').disabled = true;
      document.getElementById('connect').textContent = 'Connecting...';
      
      const connected = await this.manager.connect();
      if (!connected) throw new Error('Failed to connect');

      this.showConnected();
      this.setConnectionStatus(true);
      
      // Load pet details
      await this.loadPetDetails();
    } catch (error) {
      this.showError('Connection failed: ' + error.message);
    } finally {
      document.getElementById('connect').disabled = false;
      document.getElementById('connect').textContent = '⚡ Connect Device';
    }
  }

  async handleDisconnect() {
    await this.manager.disconnect();
    this.showDisconnected();
    this.setConnectionStatus(false);
  }

  showConnected() {
    document.getElementById('notConnected').hidden = true;
    document.getElementById('connected').hidden = false;
    document.getElementById('connect').hidden = true;
    document.getElementById('disconnect').hidden = false;
  }

  showDisconnected() {
    document.getElementById('notConnected').hidden = false;
    document.getElementById('connected').hidden = true;
    document.getElementById('connect').hidden = false;
    document.getElementById('disconnect').hidden = true;
  }

  setConnectionStatus(connected) {
    const elem = document.getElementById('connection');
    if (connected) {
      elem.textContent = `✓ Connected (ID: ${this.manager.deviceId.substring(0, 8)}...)`;
      elem.classList.add('connected');
      document.getElementById('deviceId').textContent = this.manager.deviceId;
    } else {
      elem.textContent = 'Not connected';
      elem.classList.remove('connected');
    }
  }

  async loadPetDetails() {
    try {
      const data = await this.manager.readPetData();
      
      document.getElementById('petName').textContent = data.name || 'Unnamed';
      document.getElementById('petSpecies').textContent = data.species || 'Unknown';
      
      // Render stats
      const statsHtml = this.renderStats(data);
      document.getElementById('petStats').innerHTML = statsHtml;
      
      // Fill in name fields
      document.getElementById('petNameInput').value = data.name || '';
      document.getElementById('ownerNameInput').value = data.owner || '';
      
      this.showStatus('detailStatus', `✓ Pet data loaded`, 'success');
    } catch (error) {
      this.showStatus('detailStatus', `Error: ${error.message}`, 'error');
    }
  }

  renderStats(data) {
    const stats = [
      { label: 'Owner', value: data.owner || 'Not set' },
      { label: 'Species', value: data.species || '-' },
      { label: 'Level', value: data.level || '-' },
      { label: 'Experience', value: data.experience || '-' },
      { label: 'Health', value: `${data.health || 0}/100` },
      { label: 'Hunger', value: `${data.hunger || 0}/100` },
      { label: 'Happiness', value: `${data.happiness || 0}/100` },
      { label: 'Playtime', value: data.playtime ? this.formatMinutes(data.playtime) : '-' }
    ];

    return stats.map(stat => `
      <div class="stat">
        <strong>${stat.label}</strong>
        <span class="stat-value">${stat.value}</span>
      </div>
    `).join('');
  }

  formatMinutes(minutes) {
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}h ${mins}m`;
  }

  async handleSavePetName() {
    const newName = document.getElementById('petNameInput').value.trim();
    if (!newName) {
      this.showStatus('petNameStatus', 'Please enter a pet name', 'error');
      return;
    }

    try {
      document.getElementById('savePetName').disabled = true;
      await this.manager.updatePetName(newName);
      document.getElementById('petName').textContent = newName;
      this.showStatus('petNameStatus', `✓ Pet name updated to "${newName}"`, 'success');
    } catch (error) {
      this.showStatus('petNameStatus', `Error: ${error.message}`, 'error');
    } finally {
      document.getElementById('savePetName').disabled = false;
    }
  }

  async handleSaveOwnerName() {
    const newName = document.getElementById('ownerNameInput').value.trim();
    if (!newName) {
      this.showStatus('ownerNameStatus', 'Please enter an owner name', 'error');
      return;
    }

    try {
      document.getElementById('saveOwnerName').disabled = true;
      await this.manager.updateOwnerName(newName);
      this.showStatus('ownerNameStatus', `✓ Owner name updated to "${newName}"`, 'success');
    } catch (error) {
      this.showStatus('ownerNameStatus', `Error: ${error.message}`, 'error');
    } finally {
      document.getElementById('saveOwnerName').disabled = false;
    }
  }

  async handleBackup() {
    try {
      document.getElementById('backupBtn').disabled = true;
      document.getElementById('backupBtn').textContent = 'Creating backup...';

      const backup = await this.manager.backupPetData();
      
      // Download as JSON
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2)));
      element.setAttribute('download', `vpet-backup-${backup.deviceId}-${Date.now()}.json`);
      element.style.display = 'none';
      
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      
      this.showStatus('backupStatus', '✓ Backup downloaded successfully', 'success');
    } catch (error) {
      this.showStatus('backupStatus', `Error: ${error.message}`, 'error');
    } finally {
      document.getElementById('backupBtn').disabled = false;
      document.getElementById('backupBtn').textContent = '💾 Backup';
    }
  }

  handleRestore() {
    document.getElementById('restoreFile').click();
  }

  async handleRestoreFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      
      // Verify backup structure
      if (!backup.petData || !backup.deviceId) {
        throw new Error('Invalid backup file format');
      }

      // Ask for confirmation
      const confirm = window.confirm(
        `Restore backup from ${new Date(backup.timestamp).toLocaleDateString()}?\n\n` +
        `Pet: ${backup.petData.name}\nOwner: ${backup.petData.owner}\n\n` +
        `This will overwrite current pet data.`
      );

      if (!confirm) return;

      // TODO: Implement restore command in firmware
      this.showStatus('backupStatus', '✓ Backup verified (restore feature coming soon)', 'success');
    } catch (error) {
      this.showStatus('backupStatus', `Error: ${error.message}`, 'error');
    }
  }

  async handleRefreshEvents() {
    try {
      document.getElementById('refreshEvents').disabled = true;
      const events = await this.manager.getPetEvents();
      this.renderEvents(events);
      this.showStatus('eventStatus', `✓ ${events.length} event(s) loaded`, 'success');
    } catch (error) {
      this.showStatus('eventStatus', `Error: ${error.message}`, 'error');
    } finally {
      document.getElementById('refreshEvents').disabled = false;
    }
  }

  renderEvents(events) {
    if (!events || events.length === 0) {
      document.getElementById('eventList').innerHTML = '<p class="hint">No events recorded yet.</p>';
      return;
    }

    const html = events
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20)
      .map(event => `
        <div class="event-item">
          <div class="event-date">${new Date(event.timestamp).toLocaleDateString()} ${new Date(event.timestamp).toLocaleTimeString()}</div>
          <div class="event-type">${event.type || 'Unknown'}</div>
          <div class="event-detail">${event.description || '-'}</div>
        </div>
      `).join('');

    document.getElementById('eventList').innerHTML = html;
  }

  populateFirmwareVersions() {
    const select = document.getElementById('firmwareSelect');
    select.innerHTML = '<option value="">-- Select a version --</option>';
    
    this.firmwareVersions.forEach(fw => {
      const option = document.createElement('option');
      option.value = fw.file;
      option.textContent = `v${fw.version} (${fw.date})`;
      select.appendChild(option);
    });
  }

  handleVersionSelect(event) {
    const file = event.target.value;
    if (file) {
      this.firmware = { file, version: event.target.selectedOptions[0].textContent };
      document.getElementById('firmwareFile').value = '';
    }
  }

  handleFirmwareSelect(event) {
    const file = event.target.files[0];
    if (file) {
      this.firmware = { file, version: file.name };
      document.getElementById('firmwareSelect').value = '';
      this.showStatus('updateStatus', `✓ File selected: ${file.name}`, 'success');
    }
  }

  async handleFirmwareUpdate() {
    if (!this.firmware) {
      this.showStatus('updateStatus', 'Please select a firmware file', 'error');
      return;
    }

    const confirmed = window.confirm(
      'This will update your VPet firmware to ' + this.firmware.version + '.\n\n' +
      'DO NOT disconnect your device during the update!\n\n' +
      'This process takes 2-3 minutes. Continue?'
    );

    if (!confirmed) return;

    try {
      document.getElementById('updateBtn').disabled = true;
      document.getElementById('updateProgress').hidden = false;
      document.getElementById('updateProgressText').hidden = false;
      
      const fileUrl = typeof this.firmware.file === 'string' 
        ? this.firmware.file
        : URL.createObjectURL(this.firmware.file);
      
      await this.manager.downloadFirmware(fileUrl);
      
      this.showStatus('updateStatus', '✓ Firmware update completed successfully! Device will restart.', 'success');
    } catch (error) {
      this.showStatus('updateStatus', `Firmware update failed: ${error.message}`, 'error');
    } finally {
      document.getElementById('updateBtn').disabled = false;
      document.getElementById('updateProgress').hidden = true;
      document.getElementById('updateProgressText').hidden = true;
    }
  }

  updateProgress(percent) {
    document.getElementById('updateProgressBar').style.width = percent + '%';
    document.getElementById('updateProgressText').textContent = `Updating: ${percent}%`;
  }

  showStatus(elementId, message, type) {
    const elem = document.getElementById(elementId);
    elem.textContent = message;
    elem.className = 'status ' + type;
  }

  showError(message) {
    const conn = document.getElementById('connection');
    const errorBox = document.createElement('div');
    errorBox.className = 'status error';
    errorBox.textContent = message;
    conn.parentElement.insertBefore(errorBox, conn.nextSibling);
    setTimeout(() => errorBox.remove(), 5000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.uiManager = new VPetUIManager();
  
  // Check if Web Serial API is available
  if (!navigator.serial) {
    const conn = document.getElementById('connection');
    conn.innerHTML = '<span style="color: var(--error);">❌ Web Serial API not available. Use Chrome/Edge on Windows/Linux/Mac, or Opera.</span>';
    document.getElementById('connect').disabled = true;
  }
});
