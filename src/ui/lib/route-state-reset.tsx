import { Fragment, type ReactNode } from 'react';

type RouteStateResetBoundaryProps = {
    children: ReactNode;
    routeKey: string;
};

export const RouteStateResetBoundary = ({ children, routeKey }: RouteStateResetBoundaryProps) => {
    return <Fragment key={routeKey}>{children}</Fragment>;
};
