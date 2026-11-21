// Re-exports for the settings UI. Imported by settings/ui.js so callers depend
// on a single stable path instead of PotokSDK directly.
import { PotokSDK } from 'potok-sdk';

/** @type {{ HStack: typeof PotokSDK.ui.components.HStack, VStack: typeof PotokSDK.ui.components.VStack, Text: typeof PotokSDK.ui.components.Text, Select: typeof PotokSDK.ui.components.Select, Input: typeof PotokSDK.ui.components.Input }} */
export const components = PotokSDK.ui.components;

/** @type {(id: string, css: string) => void} */
export const injectHostCss = PotokSDK.ui.injectHostCss;
