import { getErrorPresentation } from '#/lib/error-presentation';
import { ReloadErrorPanel } from './reload-error-panel';

type RouteErrorPanelProps = {
    error: Error;
    title: string;
};

export const RouteErrorPanel = ({ error, title }: RouteErrorPanelProps) => {
    const presentation = getErrorPresentation(error, { fallbackTitle: title });

    return <ReloadErrorPanel description={presentation.description} title={presentation.title} />;
};
