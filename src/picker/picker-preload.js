const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
  getSources: (refresh = false) => ipcRenderer.invoke('picker:get-sources', { refresh }),
  choose: (id, withAudio) => ipcRenderer.send('picker:choose', { id, withAudio }),
  cancel: () => ipcRenderer.send('picker:cancel')
});
