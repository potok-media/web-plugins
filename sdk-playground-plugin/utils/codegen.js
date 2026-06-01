/**
 * Generates dynamic, valid builder pattern JavaScript code for the given component and properties.
 *
 * @param {string} componentName - The name of the UI component
 * @param {Object} props - Configured properties for the component
 * @returns {string} Ready-to-copy, beautifully formatted JavaScript code
 */
export function generateCode(componentName, props = {}) {
  const safeProps = {
    text: props.text ?? '',
    color: props.color ?? '',
    variant: props.variant ?? '',
    disabled: !!props.disabled,
    label: props.label ?? '',
    placeholder: props.placeholder ?? '',
    value: props.value ?? '',
    checked: !!props.checked,
    level: props.level ?? 1,
    title: props.title ?? ''
  };

  switch (componentName) {
    case 'Badge':
      return `PotokSDK.ui.components.Badge("${safeProps.text}").color("${safeProps.color}")`;
    case 'Button':
      return `PotokSDK.ui.components.Button("${safeProps.text}").variant("${safeProps.variant}")${safeProps.disabled ? '.disabled(true)' : ''}`;
    case 'Heading':
      return `PotokSDK.ui.components.Heading("${safeProps.text}").level(${safeProps.level})`;
    case 'Text':
      return `PotokSDK.ui.components.Text("${safeProps.text}").variant("${safeProps.variant}")`;
    case 'Input':
      return `PotokSDK.ui.components.Input("field").label("${safeProps.label}").placeholder("${safeProps.placeholder}")${safeProps.value ? `.value("${safeProps.value}")` : ''}${safeProps.disabled ? '.disabled(true)' : ''}`;
    case 'Toggle':
      return `PotokSDK.ui.components.Toggle().label("${safeProps.label}")${safeProps.checked ? '.checked(true)' : ''}${safeProps.disabled ? '.disabled(true)' : ''}`;
    case 'Select':
      return `PotokSDK.ui.components.Select().label("${safeProps.label}")${safeProps.disabled ? '.disabled(true)' : ''}`;
    case 'Divider':
      return `PotokSDK.ui.components.Divider()`;
    case 'Spacer':
      return `PotokSDK.ui.components.Spacer()`;
    case 'Card':
      return `PotokSDK.ui.components.Card().title("${safeProps.title}").children([ ... ])`;
    default:
      return `// Unsupported component: ${componentName}`;
  }
}
