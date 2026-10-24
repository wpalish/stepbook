import {
  F,
  S,
  R,
  C,
  live,
  rows,
  byId,
  unique,
  required,
  minor,
  amount,
  interval,
  noOverlap,
  changed,
  immutable,
  admin,
  totalLines,
  summary,
  clock,
  label,
} from "./core/rules.js";
const definition = {
  slug: "stepbook",
  reference: 86,
  title: "StepBook",
  description:
    "Пошаговые инструкции с результатом каждого шага и отдельной проверкой перед публикацией внутри команды.",
  limitations:
    "Одна организация · Собственный сервер · Ручной ввод · Без банковских и внешних интеграций",
  collections: [
    C(
      "guides",
      "Инструкции",
      [
        F("name", "Название"),
        F("owner", "Владелец"),
        F("review", "Пересмотреть до", "date"),
        S("status", "Состояние", [
          ["draft", "Черновик"],
          ["published", "Опубликовано внутри команды"],
        ]),
      ],
      { writeRole: "admin" },
    ),
    C(
      "steps",
      "Шаги",
      [
        R("guide", "Инструкция", "guides"),
        F("order", "Порядковый номер", "integer", { min: 1, max: 100 }),
        F("action", "Действие", "textarea"),
        F("result", "Ожидаемый результат", "textarea"),
        F("source", "Источник", "url", { required: false }),
      ],
      { writeRole: "admin" },
    ),
  ],
  validate(state, before, command, actor) {
    for (const g of rows(state, "guides")) {
      const previousGuide = changed(before, "guides", g.id);
      const steps = live(state, "steps")
        .filter((s) => s.guide === g.id)
        .sort((a, b) => a.order - b.order);
      unique(steps, "order", "Номер шага");
      if (g.status === "published") {
        required(
          steps.length > 0 && steps.every((s, i) => s.order === i + 1),
          "Нужна непрерывная последовательность шагов от 1.",
        );
        if (previousGuide?.status !== "published")
          required(
            g.review >= new Date().toISOString().slice(0, 10),
            "Срок проверки инструкции истёк.",
          );
      }
    }
    for (const step of rows(state, "steps")) {
      const old = changed(before, "steps", step.id),
        guide = byId(state, "guides", step.guide),
        previousGuide = old && byId(before, "guides", old.guide);
      if (guide.status === "published" || previousGuide?.status === "published")
        required(
          old && JSON.stringify(old) === JSON.stringify(step),
          "Шаги можно менять и переносить только между черновиками инструкций.",
        );
    }
  },
  summarize(state) {
    return rows(state, "guides").map((g) =>
      summary(
        g.name + " · " + label(definition, "guides", "status", g.status),
        ...live(state, "steps")
          .filter((s) => s.guide === g.id)
          .sort((a, b) => a.order - b.order)
          .map((s) => s.order + ". " + s.action + " → " + s.result),
        "Пересмотр до " + g.review,
      ),
    );
  },
};
export default definition;
