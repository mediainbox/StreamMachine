module.exports = {
  toTime: datetime => {
    return datetime.toISOString().substr(11);
  }
}
