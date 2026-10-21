import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.yunyin.player',
  appName: '音序',
  webDir: 'dist-mobile',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b0b0d'
    }
  }
}

export default config
