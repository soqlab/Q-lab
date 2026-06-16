import os
import json
from pathlib import Path
import threading

import httpx

class QLabClient:
    def __init__(
        self,
        api_url: str,
        timeout: float = 3.0,
        api_key: str | None = None,
        queue_path: str | None = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout
        self.api_key = api_key or os.getenv("QLAB_API_KEY")
        self.queue_path = Path(
            queue_path
            or os.getenv("QLAB_QUEUE_PATH", "")
            or Path.home() / ".qlab" / "pending_runs.jsonl"
        )
        self._queue_lock = threading.Lock()
        self._threads: list[threading.Thread] = []
        self.retry_pending_async()

    def log_metrics_async(self, run_id: str, metrics: list[dict]) -> None:
        thread = threading.Thread(
            target=self._log_metrics, args=(run_id, metrics), daemon=True
        )
        self._threads.append(thread)
        thread.start()

    def _log_metrics(self, run_id: str, metrics: list[dict]) -> None:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            httpx.post(
                f"{self.api_url}/api/v1/runs/{run_id}/metrics",
                json={"metrics": metrics},
                headers=headers,
                timeout=self.timeout,
            ).raise_for_status()
        except Exception:
            pass  # Never break the researcher's workflow

    def send_benchmark_async(self, payload: dict) -> None:
        thread = threading.Thread(target=self._send_benchmark, args=(payload,), daemon=True)
        self._threads.append(thread)
        thread.start()

    def _send_benchmark(self, payload: dict) -> None:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            httpx.post(
                f"{self.api_url}/api/v1/benchmarks",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            ).raise_for_status()
        except Exception:
            pass

    def send_run_async(self, payload: dict) -> None:
        thread = threading.Thread(
            target=self._send_run,
            args=(payload,),
            daemon=True,
        )
        self._threads.append(thread)
        thread.start()

    def update_run_async(self, run_id: str, payload: dict) -> None:
        thread = threading.Thread(
            target=self._update_run,
            args=(run_id, payload),
            daemon=True,
        )
        self._threads.append(thread)
        thread.start()

    def flush(self, timeout: float = 5.0) -> None:
        self.retry_pending_async()
        for thread in list(self._threads):
            thread.join(timeout=timeout)
            if not thread.is_alive():
                self._threads.remove(thread)

    def retry_pending_async(self) -> None:
        thread = threading.Thread(target=self._retry_pending, daemon=True)
        self._threads.append(thread)
        thread.start()

    def _send_run(self, payload: dict) -> None:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key

            response = httpx.post(
                f"{self.api_url}/api/v1/runs",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except Exception:
            # Never break the researcher's Qiskit workflow
            self._enqueue(payload)
            pass

    def _send_run_sync(self, payload: dict) -> bool:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key

            response = httpx.post(
                f"{self.api_url}/api/v1/runs",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return True
        except Exception:
            return False

    def _update_run(self, run_id: str, payload: dict) -> None:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key

            response = httpx.patch(
                f"{self.api_url}/api/v1/runs/{run_id}",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
        except Exception:
            queued = {"_qlab_update_run_id": run_id, **payload}
            self._enqueue(queued)

    def _enqueue(self, payload: dict) -> None:
        try:
            with self._queue_lock:
                self.queue_path.parent.mkdir(parents=True, exist_ok=True)
                with self.queue_path.open("a", encoding="utf-8") as file:
                    file.write(json.dumps(payload) + "\n")
        except Exception:
            pass

    def _retry_pending(self) -> None:
        with self._queue_lock:
            if not self.queue_path.exists():
                return

            try:
                lines = self.queue_path.read_text(encoding="utf-8").splitlines()
            except Exception:
                return

            remaining = []
            for line in lines:
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except Exception:
                    continue

                update_run_id = payload.pop("_qlab_update_run_id", None)
                if update_run_id:
                    ok = self._update_run_sync(update_run_id, payload)
                else:
                    ok = self._send_run_sync(payload)

                if not ok:
                    if update_run_id:
                        payload = {"_qlab_update_run_id": update_run_id, **payload}
                    remaining.append(payload)

            try:
                if remaining:
                    self.queue_path.parent.mkdir(parents=True, exist_ok=True)
                    with self.queue_path.open("w", encoding="utf-8") as file:
                        for payload in remaining:
                            file.write(json.dumps(payload) + "\n")
                else:
                    self.queue_path.unlink(missing_ok=True)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Policy
    # ------------------------------------------------------------------

    def check_policy(self, payload: dict) -> dict:
        """Check a run payload against the active policy.

        Returns a dict with keys: policy_active, passed, violation_count, violations.
        Never raises — returns {policy_active: False, passed: True} if the server
        is unreachable so callers can decide how to handle.
        """
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            resp = httpx.post(
                f"{self.api_url}/api/v1/policy/check",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return {"policy_active": False, "passed": True, "violation_count": 0, "violations": []}

    def get_policy(self) -> dict:
        """Fetch the current active policy rules."""
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            resp = httpx.get(f"{self.api_url}/api/v1/policy", headers=headers, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except Exception:
            return {}

    def _update_run_sync(self, run_id: str, payload: dict) -> bool:
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key

            response = httpx.patch(
                f"{self.api_url}/api/v1/runs/{run_id}",
                json=payload,
                headers=headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Campaigns
    # ------------------------------------------------------------------

    def create_campaign(
        self,
        name: str,
        grid: list[dict],
        description: str | None = None,
        project: str | None = None,
        tags: list[str] | None = None,
    ) -> dict:
        """Create a new experiment campaign and return its campaign_id + combinations.

        ``grid`` is a list of axis dicts: [{"name": "shots", "values": [100, 500, 1000]}, ...]

        Returns::

            {
                "campaign_id": "cmp_...",
                "total_combinations": N,
                "combinations": [{"shots": 100, "backend": "ibm_kyoto"}, ...],
            }
        """
        try:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            resp = httpx.post(
                f"{self.api_url}/api/v1/campaigns",
                json={"name": name, "grid": grid, "description": description, "project": project, "tags": tags or []},
                headers=headers,
                timeout=max(self.timeout, 10.0),
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            raise RuntimeError(f"Failed to create campaign: {exc}") from exc

    def campaign_combinations(self, campaign_id: str) -> list[dict]:
        """Fetch the grid expansion for an existing campaign.

        Usage::

            for params in qlab.campaign_combinations("cmp_xyz"):
                with qlab.run(circuit) as r:
                    r.log("shots", params["shots"])
                    # submit circuit with params["shots"], params["backend"], ...
        """
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            resp = httpx.get(
                f"{self.api_url}/api/v1/campaigns/{campaign_id}/combinations",
                headers=headers,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json().get("combinations", [])
        except Exception as exc:
            raise RuntimeError(f"Failed to fetch campaign combinations: {exc}") from exc

    def get_campaign(self, campaign_id: str) -> dict:
        """Get campaign status and progress."""
        try:
            headers = {}
            if self.api_key:
                headers["X-QLab-API-Key"] = self.api_key
            resp = httpx.get(
                f"{self.api_url}/api/v1/campaigns/{campaign_id}",
                headers=headers,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            raise RuntimeError(f"Failed to get campaign: {exc}") from exc
