// 가격 눈금의 현재가 표시 바로 아래에 "봉 마감까지 남은 시간"을 띄운다 (트레이딩뷰의 카운트다운).
export class BarCountdown {
  constructor({ getBars, getStep, getColor, isEnabled }) {
    Object.assign(this, { getBars, getStep, getColor, isEnabled });
    const self = this;
    this.view = {
      coordinate: () => self.#y(),
      text: () => self.#text(),
      textColor: () => '#ffffff',
      backColor: () => self.getColor(),
      visible: () => self.isEnabled() && self.#y() != null && self.#text() !== '',
      tickVisible: () => false,
    };
  }

  attached({ series, requestUpdate }) {
    this.series = series;
    this.timer = setInterval(requestUpdate, 1000);
  }

  detached() {
    clearInterval(this.timer);
    this.series = null;
  }

  updateAllViews() {}
  priceAxisViews() { return [this.view]; }

  #y() {
    const bars = this.getBars();
    if (!this.series || !bars.length) return null;
    const y = this.series.priceToCoordinate(bars[bars.length - 1].close);
    // 현재가 표시(높이 약 18px) 바로 아래
    return y == null ? null : y + 18;
  }

  #text() {
    const bars = this.getBars();
    if (!bars.length) return '';
    const left = Math.max(0, Math.round(bars[bars.length - 1].time + this.getStep() - Date.now() / 1000));
    const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    const two = (n) => String(n).padStart(2, '0');
    if (d) return `${d}일 ${two(h)}:${two(m)}`;
    return h ? `${two(h)}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  }
}
