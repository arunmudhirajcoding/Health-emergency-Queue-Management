from datetime import datetime, timezone
from heapq import heappop, heappush
from itertools import count
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


Severity = Literal["critical", "serious", "moderate", "stable"]


SEVERITY_META = {
    "critical": {"rank": 1, "label": "Critical", "avg_minutes": 8},
    "serious": {"rank": 2, "label": "Serious", "avg_minutes": 15},
    "moderate": {"rank": 3, "label": "Moderate", "avg_minutes": 25},
    "stable": {"rank": 4, "label": "Stable", "avg_minutes": 40},
}


class PatientCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    age: int = Field(ge=0, le=120)
    severity: Severity
    symptoms: str = Field(min_length=3, max_length=240)


class Patient(PatientCreate):
    id: str
    created_at: datetime
    status: Literal["waiting", "treated"] = "waiting"
    sequence: int


class QueueItem(Patient):
    priority_rank: int
    priority_label: str
    position: int
    estimated_wait_minutes: int


class QueueState(BaseModel):
    queue: list[QueueItem]
    treated: list[Patient]
    total_waiting: int
    total_treated: int
    average_wait_minutes: int
    updated_at: datetime


app = FastAPI(title="Hospital Emergency Queue API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173","https://health-emergency-queue-management.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_queue: list[tuple[int, datetime, int, str]] = []
_patients: dict[str, Patient] = {}
_treated: list[Patient] = []
_sequence = count(1)
_lock = Lock()


def _priority_tuple(patient: Patient) -> tuple[int, datetime, int, str]:
    severity_rank = SEVERITY_META[patient.severity]["rank"]
    return severity_rank, patient.created_at, patient.sequence, patient.id


def _ordered_waiting_patients() -> list[Patient]:
    return [_patients[patient_id] for *_priority, patient_id in sorted(_queue)]


def _estimated_wait_for(position: int, patients_ahead: list[Patient]) -> int:
    if position == 1:
        return 0

    total = 0
    for patient in patients_ahead:
        total += SEVERITY_META[patient.severity]["avg_minutes"]
    return total


def _queue_state() -> QueueState:
    waiting = _ordered_waiting_patients()
    items: list[QueueItem] = []

    for index, patient in enumerate(waiting, start=1):
        severity = SEVERITY_META[patient.severity]
        items.append(
            QueueItem(
                **patient.model_dump(),
                priority_rank=severity["rank"],
                priority_label=severity["label"],
                position=index,
                estimated_wait_minutes=_estimated_wait_for(index, waiting[: index - 1]),
            )
        )

    average_wait = round(
        sum(item.estimated_wait_minutes for item in items) / len(items)
    ) if items else 0

    return QueueState(
        queue=items,
        treated=list(reversed(_treated[-8:])),
        total_waiting=len(items),
        total_treated=len(_treated),
        average_wait_minutes=average_wait,
        updated_at=datetime.now(timezone.utc),
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/queue", response_model=QueueState)
def get_queue() -> QueueState:
    with _lock:
        return _queue_state()


@app.post("/api/patients", response_model=QueueState, status_code=201)
def add_patient(patient_create: PatientCreate) -> QueueState:
    patient = Patient(
        **patient_create.model_dump(),
        id=str(uuid4()),
        created_at=datetime.now(timezone.utc),
        sequence=next(_sequence),
    )

    with _lock:
        _patients[patient.id] = patient
        heappush(_queue, _priority_tuple(patient))
        return _queue_state()


@app.post("/api/queue/next", response_model=QueueState)
def treat_next_patient() -> QueueState:
    with _lock:
        if not _queue:
            raise HTTPException(status_code=404, detail="No patients in queue")

        *_priority, patient_id = heappop(_queue)
        patient = _patients.pop(patient_id)
        treated_patient = patient.model_copy(update={"status": "treated"})
        _treated.append(treated_patient)
        return _queue_state()


@app.delete("/api/queue/{patient_id}", response_model=QueueState)
def remove_patient(patient_id: str) -> QueueState:
    with _lock:
        if patient_id not in _patients:
            raise HTTPException(status_code=404, detail="Patient not found")

        _patients.pop(patient_id)
        _queue[:] = [entry for entry in _queue if entry[-1] != patient_id]
        _queue.sort()
        return _queue_state()

