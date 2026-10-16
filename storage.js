const DB = "hs-football-fresh-v1";
let opening;
function db() {
  return (opening ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("data");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function load(key, fallback = null) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("data"),
      r = t.objectStore("data").get(key);
    r.onsuccess = () => resolve(r.result ?? fallback);
    r.onerror = () => reject(r.error);
  });
}
export async function save(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("data", "readwrite");
    t.objectStore("data").put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export function download(name, data) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([typeof data === "string" ? data : JSON.stringify(data)], {
        type: "application/json",
      }),
    );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function remove(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("data", "readwrite");
    t.objectStore("data").delete(key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
