import { useEffect, useState } from 'react';

const CHECK_INTERVAL = 5 * 60 * 60 * 1000;

function useUpdateChecker() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);

  useEffect(() => {
    const autoUpdate = localStorage.getItem('autoUpdate');
    if (autoUpdate === 'false') return;

    const compareVersions = (v1, v2) => {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);

      for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return 1;
        if (parts1[i] < parts2[i]) return -1;
      }
      return 0;
    };

    const checkForUpdates = async () => {
      try {
        const currentVersion = import.meta.env.APP_VERSION || '1.0.0';
        const response = await fetch('https://api.github.com/repos/nnfz/stretch/releases/latest', {
          headers: {
            'Accept': 'application/vnd.github.v3+json'
          }
        });

        if (!response.ok) return;

        const data = await response.json();
        const latestVersion = data.tag_name.replace('v', '');
        const asset = data.assets.find(a => a.name.endsWith('.exe'));

        if (compareVersions(currentVersion, latestVersion) < 0 && asset) {
          setHasUpdate(true);
          setUpdateInfo({
            version: latestVersion,
            downloadUrl: asset.browser_download_url,
          });
        }
      } catch (error) {
        console.error('Update check failed:', error);
      }
    };

    checkForUpdates();
    const interval = setInterval(checkForUpdates, CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  return { hasUpdate, updateInfo };
}

export default useUpdateChecker;
