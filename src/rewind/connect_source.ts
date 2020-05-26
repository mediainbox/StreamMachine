// TODO: check
connectSource = (source) => {
  if (this.source) {
    this.source.removeListener("data", this.push);
    this.logger.debug("removed old rewind data listener");
  }

  this.source = source;

  source.vitals((err, vitals) => {
    if (this.vitals.streamKey && this.vitals.streamKey === vitals.streamKey) {
      this.logger.debug("rewind buffer validated new source, keep current buffer");
    } else {
      this.updateVitals({
        // TODO: standarize globally
        streamKey: vitals.streamKey,
        framesPerSecond: vitals.framesPerSec,
        secondsPerChunk: vitals.emitDuration
      });
    }

    source.on("data", this.push);
  });
}
