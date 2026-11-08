import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ChatTextSize = 'small' | 'medium' | 'large';

interface PreferencesState {
  hydrated: boolean;
  reduceMotion: boolean;
  chatTextSize: ChatTextSize;
  hydrate: () => Promise<void>;
  setReduceMotion: (enabled: boolean) => Promise<void>;
  setChatTextSize: (size: ChatTextSize) => Promise<void>;
}

const STORAGE_KEY = 'wattar-preferences';

export const usePreferencesStore = create<PreferencesState>((set) => ({
  hydrated: false,
  reduceMotion: false,
  chatTextSize: 'medium',

  hydrate: async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        const preferences = JSON.parse(saved) as Partial<Pick<PreferencesState, 'reduceMotion' | 'chatTextSize'>>;
        set({
          reduceMotion: preferences.reduceMotion === true,
          chatTextSize: ['small', 'medium', 'large'].includes(preferences.chatTextSize ?? '')
            ? preferences.chatTextSize as ChatTextSize
            : 'medium',
        });
      }
    } catch (error) {
      console.error('[Wattar] Failed to load saved preferences:', error);
    } finally {
      set({ hydrated: true });
    }
  },

  setReduceMotion: async (reduceMotion) => {
    const current = usePreferencesStore.getState();
    const next = { reduceMotion, chatTextSize: current.chatTextSize };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ reduceMotion });
  },

  setChatTextSize: async (chatTextSize) => {
    const current = usePreferencesStore.getState();
    const next = { reduceMotion: current.reduceMotion, chatTextSize };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    set({ chatTextSize });
  },
}));
