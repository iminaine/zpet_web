// VPet Device Manager - Web Serial API interface
// Adapted for VPet firmware serial console protocol

class VPetManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.deviceId = null;
    this.petData = null;
    this.isConnected = false;
    this.analyticsEndpoint = 'https://vpet-analytics.herokuapp.com';
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.isConnected = true;
      
      // Get device ID (use serial number)
      await this.captureDeviceId();
      
      // Load pet data
      await this.readPetData();
      
      // Log connection
      await this.logAnalytics('device_connected', {
        deviceId: this.deviceId,
        timestamp: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      return false;
    }
  }

  async captureDeviceId() {
    // Use serial port info + timestamp as device ID
    this.deviceId = `${this.port.getInfo().serialNumber || 'esp32'}-${Date.now()}`;
  }

  async sendCommand(cmd, timeout = 2000) {
    if (!this.isConnected) throw new Error('Device not connected');
    
    const writer = this.port.writable.getWriter();
    const encoder = new TextEncoder();
    
    try {
      // Send command
      await writer.write(encoder.encode(cmd + '\r\n'));
      await writer.ready;
    } finally {
      writer.releaseLock();
    }
    
    // NOW read response (after writer is released)
    const response = await Promise.race([
      this.readUntilPrompt(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Command timeout')), timeout)
      )
    ]);
    
    return response;
  }

  async readUntilPrompt() {
    const reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value);
        
        // Check if we got the prompt back
        if (buffer.includes('vpet>')) {
          // Return everything before the prompt
          const lines = buffer.split('vpet>')[0].trim();
          return lines;
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    return buffer.trim();
  }

  async readPetData() {
    try {
      // Send 'status' command to get pet information
      const response = await this.sendCommand('status');
      
      // Parse the status output
      // Format: "Stage: BABY  State: IDLE  Form: 0  Age: 0 h"
      // "Health: 100  Energy: 50  Hunger: 25  Happiness: 80"
      // "Species: Guy"
      // "Name: Spike"
      
      const lines = response.split('\n');
      this.petData = {
        name: 'Unknown',
        species: 'Unknown',
        owner: '',
        level: 0,
        experience: 0,
        health: 0,
        hunger: 0,
        happiness: 0,
        playtime: 0,
        stage: 'UNKNOWN',
        state: 'UNKNOWN',
        isDead: false,
        birthDate: new Date().toISOString().split('T')[0]
      };
      
      for (const line of lines) {
        if (line.includes('Stage:')) {
          this.petData.stage = line.split('Stage:')[1].split('State:')[0].trim();
        }
        if (line.includes('State:')) {
          const match = line.match(/State:\s*(\w+)/);
          if (match) this.petData.state = match[1];
          this.petData.isDead = this.petData.state === 'DEAD';
        }
        if (line.includes('Name:')) {
          this.petData.name = line.split('Name:')[1].trim();
        }
        if (line.includes('Species:')) {
          this.petData.species = line.split('Species:')[1].trim();
        }
        if (line.includes('Health:')) {
          const match = line.match(/Health:\s*(\d+)/);
          if (match) this.petData.health = parseInt(match[1]);
        }
        if (line.includes('Hunger:')) {
          const match = line.match(/Hunger:\s*(\d+)/);
          if (match) this.petData.hunger = parseInt(match[1]);
        }
        if (line.includes('Happiness:')) {
          const match = line.match(/Happiness:\s*(\d+)/);
          if (match) this.petData.happiness = parseInt(match[1]);
        }
      }
      
      await this.logAnalytics('pet_data_read', {
        deviceId: this.deviceId,
        petName: this.petData.name,
        owner: this.petData.owner
      });
      
      return this.petData;
    } catch (error) {
      console.error('Failed to read pet data:', error);
      throw error;
    }
  }

  async updatePetName(newName) {
    try {
      // Your firmware uses: name <1-10 characters>
      if (newName.length > 10) throw new Error('Name must be 10 characters or less');
      if (newName.length < 1) throw new Error('Name must be at least 1 character');
      
      const response = await this.sendCommand(`name ${newName}`);
      
      if (response.includes('ERROR') || response.includes('Error')) {
        throw new Error(response);
      }
      
      this.petData.name = newName;
      
      await this.logAnalytics('pet_name_changed', {
        deviceId: this.deviceId,
        newName: newName
      });
      
      return true;
    } catch (error) {
      console.error('Failed to update pet name:', error);
      throw error;
    }
  }

  async revivePet() {
    try {
      const response = await this.sendCommand('revive');
      
      if (response.includes('ERROR') || response.includes('Error')) {
        throw new Error(response);
      }
      
      this.petData.isDead = false;
      this.petData.state = 'IDLE';
      
      await this.logAnalytics('pet_revived', {
        deviceId: this.deviceId,
        petName: this.petData.name
      });
      
      return true;
    } catch (error) {
      console.error('Failed to revive pet:', error);
      throw error;
    }
  }

  async resetPet() {
    try {
      const response = await this.sendCommand('reset CONFIRM');
      
      if (response.includes('ERROR') || response.includes('Error')) {
        throw new Error(response);
      }
      
      await this.logAnalytics('pet_reset', {
        deviceId: this.deviceId,
        petName: this.petData.name
      });
      
      return true;
    } catch (error) {
      console.error('Failed to reset pet:', error);
      throw error;
    }
  }

  async updateOwnerName(newName) {
    // Your firmware doesn't have owner name storage yet
    // Just acknowledge for now
    await this.logAnalytics('owner_name_requested', {
      deviceId: this.deviceId,
      newOwner: newName
    });
    return true;
  }

  async getPetEvents() {
    try {
      // For now, return basic events
      const events = [
        {
          type: 'BORN',
          timestamp: this.petData.birthDate + 'T00:00:00Z',
          description: 'Pet was born'
        }
      ];
      
      await this.logAnalytics('pet_events_read', {
        deviceId: this.deviceId,
        eventCount: events.length
      });
      
      return events;
    } catch (error) {
      console.error('Failed to read pet events:', error);
      throw error;
    }
  }

  async backupPetData() {
    try {
      const backup = {
        deviceId: this.deviceId,
        petData: this.petData,
        events: await this.getPetEvents(),
        timestamp: new Date().toISOString()
      };
      
      await this.logAnalytics('pet_backup_created', {
        deviceId: this.deviceId,
        backupSize: JSON.stringify(backup).length
      });
      
      return backup;
    } catch (error) {
      console.error('Failed to backup pet data:', error);
      throw error;
    }
  }

  async downloadFirmware(fileUrl) {
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to download firmware');
      
      const firmware = await response.arrayBuffer();
      
      // Your firmware uses: ota begin <size> <sha256-hex> <signature-hex>
      // Then: ota chunk <offset> <hex-data>
      // Finally: ota commit
      
      // For now, just log the request
      await this.logAnalytics('firmware_update_requested', {
        deviceId: this.deviceId,
        fileUrl: fileUrl,
        fileSize: firmware.byteLength
      });
      
      throw new Error('Firmware update via Web Serial requires implementation of OTA protocol');
    } catch (error) {
      console.error('Firmware update failed:', error);
      await this.logAnalytics('firmware_update_failed', {
        deviceId: this.deviceId,
        error: error.message
      });
      throw error;
    }
  }

  async logAnalytics(eventType, data) {
    // Only log if endpoint is configured and we have internet
    if (!navigator.onLine) return;
    
    try {
      await fetch(`${this.analyticsEndpoint}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          deviceId: this.deviceId,
          ...data,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString()
        })
      });
    } catch (error) {
      console.warn('Analytics logging failed:', error);
      // Don't throw - analytics failure shouldn't break the app
    }
  }

  async disconnect() {
    try {
      if (this.port) {
        await this.port.close();
        this.isConnected = false;
        
        await this.logAnalytics('device_disconnected', {
          deviceId: this.deviceId
        });
      }
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }
}

// Export for use in HTML
window.VPetManager = VPetManager;
