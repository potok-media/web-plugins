import { PotokSDK } from 'potok-sdk';
import { state, setInputValue, setToggleChecked, setSelectValue } from './state.js';

const { VStack, HStack, Card, Heading, Text, Badge, Button, Input, Toggle, Select, Divider, Spacer } = PotokSDK.ui.components;

function buildShowcaseLayout() {
  // Карточка 1: Демонстрация типографики и текстовых блоков
  const typographyCard = Card()
    .title("Типографика и Текст")
    .subtitle("Заголовки разных уровней и варианты текстовых блоков")
    .child(
      VStack()
        .spacing(12)
        .children([
          Heading("Заголовок h1").level(1),
          Heading("Заголовок h2").level(2),
          Heading("Заголовок h3").level(3),
          Heading("Заголовок h4").level(4),
          Divider(),
          Text("Основной текст (primary)").variant("primary"),
          Text("Вторичный текст (secondary)").variant("secondary"),
          Text("Текст успеха (success)").variant("success"),
          Text("Текст ошибки (error)").variant("error"),
          Text("Текст-подсказка (hint)").variant("hint"),
          Text("Жирный текст").bold(true)
        ])
    );

  // Карточка 2: Демонстрация кнопок и бейджей
  const controlsCard = Card()
    .title("Кнопки и Индикаторы")
    .subtitle("Варианты кнопок и информационные бейджи статусов")
    .child(
      VStack()
        .spacing(14)
        .children([
          Text("Варианты кнопок (Button):").bold(true).variant("primary").size("sm"),
          HStack().spacing(8).children([
            Button("Primary").variant("primary").onClick(() => PotokSDK.ui.showHUD("success", "Нажата кнопка Primary!")),
            Button("Secondary").variant("secondary").onClick(() => PotokSDK.ui.showHUD("info", "Нажата кнопка Secondary!")),
            Button("Ghost").variant("ghost").onClick(() => PotokSDK.ui.showHUD("warning", "Нажата кнопка Ghost!")),
            Button("Danger").variant("danger").onClick(() => PotokSDK.ui.showHUD("error", "Нажата кнопка Danger!"))
          ]),
          HStack().spacing(8).children([
            Button("Заблокировано").variant("primary").disabled(true)
          ]),
          Divider(),
          Text("Цветовые бейджи (Badge):").bold(true).variant("primary").size("sm"),
          HStack().spacing(8).children([
            Badge("Успешно").color("success"),
            Badge("Предупреждение").color("warning"),
            Badge("Ошибка").color("error"),
            Badge("Инфо").color("info")
          ])
        ])
    );

  // Карточка 3: Инпуты, Свитчи и Выпадающие списки
  const formsCard = Card()
    .title("Формы и Управление")
    .subtitle("Инпуты, интерактивные переключатели и списки выбора")
    .child(
      VStack()
        .spacing(14)
        .children([
          Input("input-demo")
            .label("Текстовое поле ввода (Input)")
            .placeholder("Введите текст...")
            .value(state.inputValue)
            .onChange((val) => {
              setInputValue(val);
              PotokSDK.ui.showHUD("info", `Значение изменено: ${val}`);
            }),
          
          Toggle("toggle-demo")
            .label("Интерактивный свитч (Toggle)")
            .description("Измените состояние переключателя")
            .checked(state.toggleChecked)
            .onChange((checked) => {
              setToggleChecked(checked);
              PotokSDK.ui.showHUD(checked ? "success" : "warning", `Состояние свитча: ${checked ? "ВКЛ" : "ВЫКЛ"}`);
            }),

          Select("select-demo")
            .label("Выпадающий список (Select)")
            .options([
              { label: "Вариант А", value: "A" },
              { label: "Вариант Б", value: "B" },
              { label: "Вариант В", value: "C" }
            ])
            .selected(state.selectValue)
            .onChange((val) => {
              setSelectValue(val);
              PotokSDK.ui.showHUD("info", `Выбран: ${val}`);
            })
        ])
    );

  // Карточка 4: Зеркало состояния (Реактивное отображение изменений)
  const stateMirrorCard = Card()
    .title("Реактивное Состояние")
    .subtitle("Динамический рендеринг значений из состояния плагина")
    .child(
      VStack()
        .spacing(12)
        .children([
          Text("Введено в инпуте:").variant("secondary").size("sm"),
          Badge(state.inputValue || "Пустая строка").color("info"),
          Spacer().height(4),
          
          Text("Состояние свитча:").variant("secondary").size("sm"),
          Badge(state.toggleChecked ? "ВКЛЮЧЕН (true)" : "ВЫКЛЮЧЕН (false)").color(state.toggleChecked ? "success" : "error"),
          Spacer().height(4),
          
          Text("Выбранная опция списка:").variant("secondary").size("sm"),
          Badge(`Опция: ${state.selectValue}`).color("warning")
        ])
    );

  // Сетка: Разделение контента на две колонки
  const leftColumn = VStack().flex(1).spacing(16).children([
    typographyCard,
    formsCard
  ]);

  const rightColumn = VStack().flex(1).spacing(16).children([
    controlsCard,
    stateMirrorCard
  ]);

  return HStack()
    .spacing(20)
    .children([
      leftColumn,
      rightColumn
    ]);
}

// Регистрируем вкладку в слот страниц расширений extension-page
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground',
  slotName: 'extension-page',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: buildShowcaseLayout()
    };
  }
});

// Регистрируем кнопку быстрого перехода в левом меню боковой панели (сразу после Настроек)
PotokSDK.registerSlotContribution({
  id: 'potok-sdk-playground-sidebar',
  slotName: 'sidebar-menu',
  render() {
    return {
      label: 'Конструктор SDK',
      layout: PotokSDK.ui.components.Button('Конструктор SDK')
        .variant('sidebar-item')
        .icon('terminal')
        .onClick(() => {
          PotokSDK.ui.navigateTo('/extensions/potok-sdk-playground');
        })
    };
  }
});


// Перерисовываем весь макет при изменении реактивного состояния
state.$subscribe(() => {
  PotokSDK.ui.render(buildShowcaseLayout(), 'potok-sdk-playground');
});
