/**
 * ربط هوية الجهاز بالتخزين المحلي الفعلي، ووصف الجهاز الحالي.
 * (الجزء غير النقي — لا يُختبر مباشرة، لأن كل منطقه في `deviceId.ts`.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createDeviceIdentity } from './deviceId';

export const deviceIdentity = createDeviceIdentity(AsyncStorage);

export interface DeviceDescription {
  deviceId: string;
  deviceInfo: { platform: string; os_version: string };
  userAgent: string;
}

/** يصف الجهاز الحالي بالصيغة التي تنتظرها الدالة `record_my_session_started`. */
export async function describeDevice(): Promise<DeviceDescription> {
  const deviceId = await deviceIdentity.getId();
  const osVersion = String(Platform.Version);
  return {
    deviceId,
    deviceInfo: { platform: Platform.OS, os_version: osVersion },
    userAgent: `Wattar/${Platform.OS} ${osVersion}`,
  };
}
