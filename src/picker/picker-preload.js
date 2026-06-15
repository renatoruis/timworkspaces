const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerAPI', {
  getSources: () => ipcRenderer.invoke('picker:get-sources'),
  choose: (id, withAudio) => ipcRenderer.send('picker:choose', { id, withAudio }),
  cancel: () => ipcRenderer.send('picker:cancel')
});
