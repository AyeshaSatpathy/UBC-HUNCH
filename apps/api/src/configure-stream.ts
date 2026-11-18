const key = process.env.QUICKNODE_API_KEY;
const destination = process.env.QUICKNODE_WEBHOOK_URL;
const securityToken = process.env.QUICKNODE_STREAM_SECURITY_TOKEN;
if (!key || !destination || !securityToken || securityToken.length < 32 || new URL(destination).protocol !== "https:") {
  throw new Error("Set QUICKNODE_API_KEY, QUICKNODE_STREAM_SECURITY_TOKEN (32+ characters), and QUICKNODE_WEBHOOK_URL");
}
const filter = await Bun.file(new URL("../quicknode-filter.js", import.meta.url)).text();
const response = await fetch("https://api.quicknode.com/streams/rest/v1/streams", {
  method: "POST",
  headers: { "x-api-key": key, "content-type": "application/json" },
  body: JSON.stringify({
    name: "Hunch CampusMarkets Arc",
    external_id: "hunch-campusmarkets-5042002-v1",
    network: "arc-testnet",
    dataset: "logs",
    region: "usa_east",
    dataset_batch_size: 1,
    elastic_batch_enabled: true,
    destination: "webhook",
    destination_attributes: {
      url: destination,
      compression: "none",
      security_token: securityToken,
      max_retry: 10,
      retry_interval_sec: 5,
      post_timeout_sec: 10,
    },
    status: "paused",
    start_range: 72337332,
    fix_block_reorgs: 0,
    keep_distance_from_tip: 0,
    filter_function: Buffer.from(filter).toString("base64"),
  }),
});
if (!response.ok) throw new Error("QuickNode Stream configuration failed with HTTP " + response.status);
const result = await response.json() as {
  id?: string;
  status?: string;
  data?: { id?: string; status?: string };
};
const stream = result.data ?? result;
// An idempotent retry can return an existing active Stream unchanged.
console.log(JSON.stringify({ id: stream.id, status: stream.status, requestedDestination: destination }));
