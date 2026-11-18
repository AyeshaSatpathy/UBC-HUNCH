// Paste into the QuickNode Streams Logs dataset filter editor.
function main(stream) {
  const address = "0x73dd30b231f405c1dcf0812c64ddcc5f02143d20";
  return {
    network: "arc-testnet",
    start: stream.metadata.batch_start_range,
    end: stream.metadata.batch_end_range,
    logs: stream.data.flat(Infinity).filter(log => log.address?.toLowerCase() === address),
  };
}
