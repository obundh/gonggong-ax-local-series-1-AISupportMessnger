const MINIMUM_GEMMA4_BILLIONS = 4;

function gemma4CapacityBillions(modelTag) {
  const text = String(modelTag || "").trim().toLowerCase();
  if (!text || !/(?:^|[\\/])gemma4(?::|$)/.test(text)) return null;
  const variant = text.slice(text.lastIndexOf("gemma4") + "gemma4".length);
  const match = variant.match(/(?:^|[:._-])e?(\d+(?:\.\d+)?)b(?:$|[-._:])/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sttTurboPerformanceNotice(modelTag) {
  const capacityBillions = gemma4CapacityBillions(modelTag);
  const adequate = capacityBillions !== null && capacityBillions >= MINIMUM_GEMMA4_BILLIONS;
  return Object.freeze({
    adequate,
    capacityBillions,
    modelTagRecognized: capacityBillions !== null,
    minimum: "gemma4:e4b",
    warning: adequate
      ? ""
      : "현재 선택한 로컬 AI가 Gemma4 e4b 이상으로 확인되지 않습니다. Turbo는 무거울 수 있으니 Lite/영어용 small을 권장합니다.",
  });
}

module.exports = {
  MINIMUM_GEMMA4_BILLIONS,
  gemma4CapacityBillions,
  sttTurboPerformanceNotice,
};
