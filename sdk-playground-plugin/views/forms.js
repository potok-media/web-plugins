import { PotokSDK } from 'potok-sdk';

const { VStack, Card, Input, Toggle, Select } = PotokSDK.ui.components;

export function buildFormsCard(state, setInputValue, setToggleChecked, setSelectValue) {
  return Card()
    .title("3. Формы и Управление (Input, Toggle & Select)")
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
            })
        ])
    );
}
