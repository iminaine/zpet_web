// VPet Device Manager - Web Serial API interface
class VPetManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.deviceId = null;
    this.petData = null;
    this.isConnected = false;
    this.analyticsEndpoint = 'https://vpet-analytics.herokuapp.com'; // Configure this later
  }

  async connect() {
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200 });
      this.isConnected = true;
      
      // Extract device ID from serial port info
      await this.captureDeviceId();
      
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
    // Try to get unique ID from device (MAC address or built-in device ID)
    try {
      // Request device identifier from firmware
      const id = await this.sendCommand('GET_DEVICE_ID');
      this.deviceId = id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch {
      // Fallback: use serial port info + timestamp
      this.deviceId = `${this.port.getInfo().serialNumber || 'unknown'}-${Date.now()}`;
    }
  }

  async sendCommand(cmd, timeout = 2000) {
    if (!this.isConnected) throw new Error('Device not connected');
    
    const writer = this.port.writable.getWriter();
    const encoder = new TextEncoder();
    
    try {
      await writer.write(encoder.encode(cmd + '\n'));
      
      // Read response with timeout
      const response = await Promise.race([
        this.readResponse(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Command timeout')), timeout)
        )
      ]);
      
      return response;
    } finally {
      writer.releaseLock();
    }
  }

  async readResponse() {
    const reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value);
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.trim()) return line.trim();
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async readPetData() {
    try {
      const response = await this.sendCommand('GET_PET_DATA');
      this.petData = JSON.parse(response);
      
      // Log data read
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
      await this.sendCommand(`SET_PET_NAME:${newName}`);
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

  async updateOwnerName(newName) {
    try {
      await this.sendCommand(`SET_OWNER_NAME:${newName}`);
      this.petData.owner = newName;
      
      await this.logAnalytics('owner_name_changed', {
        deviceId: this.deviceId,
        newOwner: newName
      });
      
      return true;
    } catch (error) {
      console.error('Failed to update owner name:', error);
      throw error;
    }
  }

  async getPetEvents() {
    try {
      const response = await this.sendCommand('GET_PET_EVENTS');
      const events = JSON.parse(response);
      
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
      
      // Send firmware in chunks
      const chunkSize = 256;
      const chunks = Math.ceil(firmware.byteLength / chunkSize);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, firmware.byteLength);
        const chunk = new Uint8Array(firmware, start, end - start);
        
        await this.sendFirmwareChunk(chunk, i, chunks);
        
        // Report progress
        const progress = ((i + 1) / chunks) * 100;
        window.dispatchEvent(new CustomEvent('firmwareProgress', { 
          detail: { progress: Math.round(progress) } 
        }));
      }
      
      // Verify and finalize
      const checksum = await this.calculateChecksum(firmware);
      await this.sendCommand(`FINALIZE_FIRMWARE:${checksum}`);
      
      await this.logAnalytics('firmware_updated', {
        deviceId: this.deviceId,
        fileUrl: fileUrl,
        fileSize: firmware.byteLength
      });
      
      return true;
    } catch (error) {
      console.error('Firmware update failed:', error);
      await this.logAnalytics('firmware_update_failed', {
        deviceId: this.deviceId,
        error: error.message
      });
      throw error;
    }
  }

  async sendFirmwareChunk(chunk, index, total) {
    const writer = this.port.writable.getWriter();
    try {
      const header = new Uint8Array([0xFF, 0xAA, index & 0xFF, (index >> 8) & 0xFF]);
      await writer.write(header);
      await writer.write(chunk);
      
      // Wait for ACK
      const ack = await this.readResponse();
      if (ack !== 'ACK') throw new Error(`Chunk ${index} not acknowledged`);
    } finally {
      writer.releaseLock();
    }
  }

  async calculateChecksum(data) {
    const view = new Uint8Array(data);
    let sum = 0;
    for (let byte of view) sum = (sum + byte) & 0xFF;
    return sum.toString(16).padStart(2, '0');
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
