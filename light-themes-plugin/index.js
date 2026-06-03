import { PotokSDK } from 'potok-sdk';

const { VStack, Text, Select } = PotokSDK.ui.components;

const themes = [
  {
    id: "lightClassic",
    name: "Light Classic",
    variables: {
      "--bg-window": "hsl(240, 11%, 96%)",
      "--bg-sidebar": "hsl(240, 6%, 94%)",
      "--bg-surface": "hsl(0, 0%, 100%)",
      "--bg-surface-high": "hsl(240, 11%, 95%)",
      "--bg-surface-highest": "hsl(240, 11%, 91%)",
      "--text-primary": "hsl(240, 5%, 8%)",
      "--text-secondary": "hsl(240, 3%, 32%)",
      "--text-tertiary": "hsl(240, 2%, 56%)",
      "--accent": "hsl(211, 100%, 50%)",
      "--accent-hover": "hsl(210, 100%, 40%)",
      "--accent-dim": "hsla(211, 100%, 50%, 0.1)",
      "--accent-semi": "hsla(211, 100%, 50%, 0.3)",
      "--text-accent": "hsl(0, 0%, 100%)",
      "--glass-bg": "hsla(0, 0%, 100%, 0.7)",
      "--glass-border": "1px solid hsla(0, 0%, 0%, 0.08)"
    }
  },
  {
    id: "pastelPeach",
    name: "Pastel Peach",
    variables: {
      "--bg-window": "hsl(28, 76%, 97%)",
      "--bg-sidebar": "hsl(25, 61%, 94%)",
      "--bg-surface": "hsl(0, 0%, 100%)",
      "--bg-surface-high": "hsl(27, 64%, 95%)",
      "--bg-surface-highest": "hsl(25, 48%, 90%)",
      "--text-primary": "hsl(17, 19%, 15%)",
      "--text-secondary": "hsl(20, 17%, 35%)",
      "--text-tertiary": "hsl(20, 14%, 57%)",
      "--accent": "hsl(13, 82%, 63%)",
      "--accent-hover": "hsl(13, 70%, 55%)",
      "--accent-dim": "hsla(13, 82%, 63%, 0.1)",
      "--accent-semi": "hsla(13, 82%, 63%, 0.3)",
      "--text-accent": "hsl(0, 0%, 100%)",
      "--glass-bg": "hsla(0, 0%, 100%, 0.7)",
      "--glass-border": "1px solid hsla(13, 82%, 63%, 0.1)"
    }
  },
  {
    id: "softMint",
    name: "Soft Mint",
    variables: {
      "--bg-window": "hsl(158, 36%, 96%)",
      "--bg-sidebar": "hsl(155, 32%, 93%)",
      "--bg-surface": "hsl(0, 0%, 100%)",
      "--bg-surface-high": "hsl(154, 29%, 91%)",
      "--bg-surface-highest": "hsl(153, 25%, 86%)",
      "--text-primary": "hsl(154, 23%, 12%)",
      "--text-secondary": "hsl(159, 12%, 33%)",
      "--text-tertiary": "hsl(159, 9%, 55%)",
      "--accent": "hsl(158, 60%, 45%)",
      "--accent-hover": "hsl(157, 63%, 38%)",
      "--accent-dim": "hsla(158, 60%, 45%, 0.1)",
      "--accent-semi": "hsla(158, 60%, 45%, 0.3)",
      "--text-accent": "hsl(0, 0%, 100%)",
      "--glass-bg": "hsla(0, 0%, 100%, 0.7)",
      "--glass-border": "1px solid hsla(158, 60%, 45%, 0.1)"
    }
  }
];

// Register custom themes during initialization
PotokSDK.ui.registerThemes(themes);

PotokSDK.registerSlotContribution({
  id: "settings-color-accent-slot",
  slotName: "settings-color-accent",
  render(props) {
    const currentTheme = props.accentTheme || "nordicFrost";

    const label = Text("Цветовой акцент")
      .variant("secondary")
      .size("sm")
      .bold(true);

    const select = Select("accent-theme-select")
      .options([
        { value: "nordicFrost", label: "Nordic Frost" },
        { value: "amberGold", label: "Amber Gold" },
        { value: "sageMuted", label: "Sage Muted" },
        { value: "graphite", label: "Graphite" },
        { value: "system", label: "System Accent" },
        { value: "lightClassic", label: "Light Classic" },
        { value: "pastelPeach", label: "Pastel Peach" },
        { value: "softMint", label: "Soft Mint" }
      ])
      .value(currentTheme)
      .onChange((themeId) => {
        PotokSDK.ui.setAccentTheme(themeId);
      });

    const layout = VStack()
      .spacing(8)
      .children([
        label,
        select
      ]);

    return {
      label: "Цветовые схемы",
      layout: layout
    };
  }
});
