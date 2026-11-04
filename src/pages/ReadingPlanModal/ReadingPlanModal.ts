/**
 * The reading plan: exactly what Bunsho will read, in which order, for how many credits. This is how order is settled without
 * guessing, and it replaces any rule about how a vault must be laid out. Resolves null when the writer closes it.
 */
import { Modal, setIcon, Setting, type App } from "obsidian";
import { TextAction } from "@/atoms/TextAction";
import type { PlanAnswer, PlanRequest } from "@/controllers/ContinuityController";
import { planQuote, type PlannedItem } from "@/helpers/sources";
import { formatNumber } from "@/utils/format";

export function reviewPlan(app: App, request: PlanRequest): Promise<PlanAnswer | null> {
  return new Promise((resolve) => {
    let answered = false;
    let items: PlannedItem[] = [...request.items];
    const modal = new Modal(app);
    const finish = (answer: PlanAnswer) => { answered = true; resolve(answer); modal.close(); };
    const confirm = () => finish({ kind: "plan", plan: { order: items.map((i) => i.id), excluded: items.filter((i) => !i.included).map((i) => i.id) } });
    modal.modalEl.addClass("bunsho-plan");
    modal.titleEl.setText("Reading plan");

    const { contentEl } = modal;
    const head = contentEl.createDiv({ cls: "bunsho-plan-head" });
    const list = contentEl.createDiv({ cls: "bunsho-plan-list" });
    const summary = contentEl.createDiv({ cls: "bunsho-plan-summary" });
    const buttons = new Setting(contentEl);
    let primary: { setDisabled(disabled: boolean): unknown } | undefined;

    const name = request.source.path === "/" ? "your whole vault" : `“${request.source.path}”`;
    head.createSpan({ text: `Bunsho will read ${name} in this order. Untick anything that is not story. ` });
    TextAction(head, { label: "Read something else", onClick: () => finish({ kind: "change_source" }) });

    const renderSummary = () => {
      const quote = planQuote(items);
      const credits = request.priceFor(quote.chars);
      summary.empty();
      const size = `${formatNumber(quote.sources)} of ${formatNumber(items.length)} ${request.noun(items.length)}, about ${formatNumber(quote.words)} words.`;
      summary.createDiv({ text: request.action === "check" && credits !== null && quote.units > 0
        ? `${size} This check costs about ${formatNumber(credits)} credits${request.balance === null ? "" : ` (you have ${formatNumber(request.balance)})`}.` : size });
      const problem = quote.units === 0 ? "Nothing is ticked." : quote.problems[0];
      if (problem) summary.createDiv({ cls: "bunsho-problem", text: problem });
      primary?.setDisabled(Boolean(problem));
    };

    const renderList = () => {
      list.empty();
      items.forEach((item, index) => {
        const row = list.createDiv({ cls: `bunsho-plan-row${item.included ? "" : " is-out"}` });
        const label = row.createEl("label", { cls: "bunsho-plan-label" });
        const box = label.createEl("input", { type: "checkbox" });
        box.checked = item.included;
        box.onchange = () => { items = items.map((i) => (i.id === item.id ? { ...i, included: box.checked } : i)); renderList(); renderSummary(); };
        label.createSpan({ cls: "bunsho-plan-name", text: item.label });
        row.createSpan({ cls: "bunsho-fact", text: formatNumber(item.text.length) });
        const move = (to: number, icon: string, title: string, disabled: boolean) => {
          const button = row.createEl("button", { cls: "clickable-icon bunsho-plan-move", attr: { "aria-label": title } });
          setIcon(button, icon);
          button.disabled = disabled;
          button.onclick = () => {
            const next = [...items];
            next.splice(to, 0, ...next.splice(index, 1));
            items = next;
            renderList();
            list.querySelectorAll<HTMLButtonElement>(".bunsho-plan-move")[to * 2 + (icon === "arrow-up" ? 0 : 1)]?.focus();
          };
        };
        move(index - 1, "arrow-up", `Move ${item.label} up`, index === 0);
        move(index + 1, "arrow-down", `Move ${item.label} down`, index === items.length - 1);
      });
    };

    buttons.addButton((b) => b.setButtonText("Not now").onClick(() => modal.close()));
    buttons.addButton((b) => { primary = b; b.setButtonText(request.action === "check" ? "Check" : "Save plan").setCta().onClick(confirm); });
    renderList();
    renderSummary();
    modal.onClose = () => { if (!answered) resolve(null); };
    modal.open();
  });
}
