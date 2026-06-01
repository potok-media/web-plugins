import { PotokSDK } from 'potok-sdk';

/**
 * Metadata registry specifying the configurable property fields for each simple component.
 */
export const metadataRegistry = {
  Badge: ['text', 'color'],
  Button: ['text', 'variant', 'disabled'],
  Heading: ['text', 'level'],
  Text: ['text', 'variant'],
  Input: ['label', 'placeholder', 'disabled', 'value'],
  Toggle: ['label', 'checked', 'disabled'],
  Select: ['label', 'disabled'],
  Divider: [],
  Spacer: [],
  Card: ['title']
};

/**
 * Returns list of simple components available in PotokSDK.ui.components,
 * excluding structural helpers or layout elements like VStack and HStack.
 * Falls back to registry keys if PotokSDK components are not yet initialized or undefined.
 *
 * @returns {string[]} List of component names.
 */
export function getAvailableComponents() {
  const componentsSource = PotokSDK?.ui?.components 
    ? Object.keys(PotokSDK.ui.components) 
    : Object.keys(metadataRegistry);

  const excluded = ['VStack', 'HStack'];
  return componentsSource.filter(name => !excluded.includes(name));
}
