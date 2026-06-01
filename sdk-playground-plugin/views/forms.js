import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Text, Input, Toggle, Select, Divider, SearchBar } = PotokSDK.ui.components;

export function buildFormsCard(state, setInputValue, setToggleChecked, setSelectValue, setSearchQuery) {
  return Card()
    .title("3. Формы, Управление и Поиск (Input, Toggle, Select & SearchBar)")
    .subtitle("Инпуты, интерактивные свитчи, меню выбора и премиальный поиск")
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
            }),
          
          Toggle("toggle-demo")
            .label("Интерактивный свитч (Toggle)")
            .description("Измените состояние переключателя")
            .checked(state.toggleChecked)
            .onChange((checked) => {
              setToggleChecked(checked);
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
            }),

          Divider(),

          Text("Системная строка поиска (SearchBar):").bold(true).variant("primary").size("sm"),
          SearchBar()
            .placeholder("Быстрый поиск по названию фильма или сериала...")
            .value(state.searchQuery)
            .onChange((val) => {
              setSearchQuery(val);
            })
            .onClear(() => {
              setSearchQuery("");
            })
        ])
    );
}
