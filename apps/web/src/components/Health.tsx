import { useState, useEffect } from "preact/hooks";

export default function Health() {
  const [status, setStatus] = useState("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setStatus(JSON.stringify(d)))
      .catch(() => setStatus("API unreachable"));
  }, []);

  return <p>API: {status}</p>;
}
