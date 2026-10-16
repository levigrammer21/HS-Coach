export async function encodePayload(value) {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === "undefined")
    return { payload: json, encoding: "json" };
  const stream = new Blob([json])
      .stream()
      .pipeThrough(new CompressionStream("gzip")),
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { payload: btoa(binary), encoding: "gzip" };
}
export async function decodePayload(doc) {
  if (doc.encoding !== "gzip") return JSON.parse(doc.payload);
  const bytes = Uint8Array.from(atob(doc.payload), (c) => c.charCodeAt(0)),
    stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
