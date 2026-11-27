import { NavLink } from 'react-router-dom'
export default function PlanNavigation() {
  return (
    <nav className="plan-navigation" aria-label="Training setup">
      <NavLink to="/plan" end>
        Overview
      </NavLink>
      <NavLink to="/plan/routines">Routines</NavLink>
      <NavLink to="/plan/splits">Splits</NavLink>
      <NavLink to="/plan/calendar">Calendar</NavLink>
      <NavLink to="/exercises">Exercises</NavLink>
    </nav>
  )
}
