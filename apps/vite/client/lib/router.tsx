import {
  BrowserRouter as ReactRouterBrowserRouter,
  Route as ReactRouterRoute,
  Routes as ReactRouterRoutes,
} from "react-router-dom"
import type { ReactElement } from "react"

// React 18 web types and React 19 mobile types coexist in this workspace.
// This keeps the placeholder Vite router JSX-compatible until the repo fully
// aligns on one React major or the packages are further isolated.
type CompatComponent<Props> = (props: Props) => ReactElement | null

type BrowserRouterProps = Parameters<typeof ReactRouterBrowserRouter>[0]
type RoutesProps = Parameters<typeof ReactRouterRoutes>[0]
type RouteProps = Parameters<typeof ReactRouterRoute>[0]

export const BrowserRouter =
  ReactRouterBrowserRouter as unknown as CompatComponent<BrowserRouterProps>

export const Routes =
  ReactRouterRoutes as unknown as CompatComponent<RoutesProps>

export const Route =
  ReactRouterRoute as unknown as CompatComponent<RouteProps>
