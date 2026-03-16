"""
Suites router — manage test suites and their test cases.

Endpoints:
  POST   /suites/                    create a suite
  GET    /suites/                    list all suites
  GET    /suites/{suite_id}          get suite + its test cases
  PUT    /suites/{suite_id}          update suite metadata
  DELETE /suites/{suite_id}          delete suite (cascades to test cases)
  POST   /suites/{suite_id}/cases    add a test case to a suite
  DELETE /suites/{suite_id}/cases/{case_id}  remove a test case
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.database import get_session
from app.models.schema import (
    Suite, SuiteCreate, SuiteRead,
    TestCase, TestCaseCreate, TestCaseRead,
)
from datetime import datetime

router = APIRouter()


# ── Suites ─────────────────────────────────────────────────────────────────────

@router.post("/", response_model=SuiteRead)
def create_suite(suite: SuiteCreate, session: Session = Depends(get_session)):
    db_suite = Suite.from_orm(suite)
    session.add(db_suite)
    session.commit()
    session.refresh(db_suite)
    return db_suite


@router.get("/", response_model=list[SuiteRead])
def list_suites(session: Session = Depends(get_session)):
    return session.exec(select(Suite).order_by(Suite.created_at.desc())).all()


@router.get("/{suite_id}", response_model=dict)
def get_suite(suite_id: int, session: Session = Depends(get_session)):
    suite = session.get(Suite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    cases = session.exec(
        select(TestCase).where(TestCase.suite_id == suite_id)
    ).all()
    return {
        "suite": SuiteRead.from_orm(suite),
        "test_cases": [TestCaseRead.from_orm(c) for c in cases],
    }


@router.put("/{suite_id}", response_model=SuiteRead)
def update_suite(suite_id: int, updates: SuiteCreate, session: Session = Depends(get_session)):
    suite = session.get(Suite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    for field, value in updates.dict(exclude_unset=True).items():
        setattr(suite, field, value)
    suite.updated_at = datetime.utcnow()
    session.add(suite)
    session.commit()
    session.refresh(suite)
    return suite


@router.delete("/{suite_id}")
def delete_suite(suite_id: int, session: Session = Depends(get_session)):
    suite = session.get(Suite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    cases = session.exec(select(TestCase).where(TestCase.suite_id == suite_id)).all()
    for c in cases:
        session.delete(c)
    session.delete(suite)
    session.commit()
    return {"deleted": suite_id}


# ── Test Cases ─────────────────────────────────────────────────────────────────

@router.post("/{suite_id}/cases", response_model=TestCaseRead)
def add_test_case(suite_id: int, case: TestCaseCreate, session: Session = Depends(get_session)):
    if not session.get(Suite, suite_id):
        raise HTTPException(status_code=404, detail="Suite not found")
    db_case = TestCase.from_orm(case)
    db_case.suite_id = suite_id
    session.add(db_case)
    session.commit()
    session.refresh(db_case)
    return db_case


@router.delete("/{suite_id}/cases/{case_id}")
def delete_test_case(suite_id: int, case_id: int, session: Session = Depends(get_session)):
    case = session.get(TestCase, case_id)
    if not case or case.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Test case not found")
    session.delete(case)
    session.commit()
    return {"deleted": case_id}
