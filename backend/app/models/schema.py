"""
Database schema for EvalLayer.

Four tables mirror the core EvalLayer concepts:
  Suite      — a named collection of test cases
  TestCase   — a single prompt + expected output + validation config
  Run        — one execution of a Suite against a specific model/config
  Result     — one row per TestCase per Run, storing output + scores
"""
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field, Column, JSON


# ── Suites ────────────────────────────────────────────────────────────────────

class SuiteBase(SQLModel):
    name: str = Field(index=True)
    description: Optional[str] = None
    prompt_config: dict = Field(default_factory=dict, sa_column=Column(JSON))


class Suite(SuiteBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SuiteCreate(SuiteBase):
    pass


class SuiteRead(SuiteBase):
    id: int
    created_at: datetime
    updated_at: datetime


# ── Test Cases ─────────────────────────────────────────────────────────────────

class TestCaseBase(SQLModel):
    model_config = {"protected_namespaces": ()}
    suite_id: int = Field(foreign_key="suite.id")
    name: Optional[str] = None
    input_data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    expected_output: str
    check_strict: bool = False
    check_normalised: bool = True
    check_llm: bool = False
    model_override: Optional[str] = None


class TestCase(TestCaseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TestCaseCreate(TestCaseBase):
    pass


class TestCaseRead(TestCaseBase):
    id: int
    created_at: datetime


# ── Runs ───────────────────────────────────────────────────────────────────────

class RunBase(SQLModel):
    model_config = {"protected_namespaces": ()}
    suite_id: int = Field(foreign_key="suite.id")
    model_id: str
    provider: str
    run_config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    label: Optional[str] = None


class Run(RunBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    total_cases: int = 0
    passed: int = 0
    failed: int = 0
    pass_rate: float = 0.0
    avg_latency_ms: float = 0.0
    status: str = "pending"


class RunCreate(RunBase):
    pass


class RunRead(RunBase):
    id: int
    started_at: datetime
    completed_at: Optional[datetime]
    total_cases: int
    passed: int
    failed: int
    pass_rate: float
    avg_latency_ms: float
    status: str


# ── Results ────────────────────────────────────────────────────────────────────

class ResultBase(SQLModel):
    run_id: int = Field(foreign_key="run.id")
    test_case_id: int = Field(foreign_key="testcase.id")
    actual_output: str
    strict_passed: Optional[bool] = None
    normalised_passed: Optional[bool] = None
    llm_passed: Optional[bool] = None
    passed: bool = False
    reason: Optional[str] = None
    latency_ms: float = 0.0
    raw_response: dict = Field(default_factory=dict, sa_column=Column(JSON))


class Result(ResultBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ResultCreate(ResultBase):
    pass


class ResultRead(ResultBase):
    id: int
    created_at: datetime
