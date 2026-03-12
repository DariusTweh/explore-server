function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function getOpenAIModels() {
  const legacy = clean(process.env.OPENAI_MODEL);
  const chatModel = clean(process.env.OPENAI_CHAT_MODEL) || legacy || "gpt-5-mini";
  const routerModel = clean(process.env.OPENAI_ROUTER_MODEL) || chatModel;
  const summaryModel = clean(process.env.OPENAI_SUMMARY_MODEL) || routerModel || chatModel;

  return {
    chatModel,
    routerModel,
    summaryModel,
  };
}
