import { useMatch } from 'react-router-dom';

/** Which part of the definition workspace the URL points at. */
export function useDefinitionRoute() {
  const newDefinitionMatch = useMatch('/admin/file-definitions/new');
  const editDefinitionMatch = useMatch('/admin/file-definitions/:definitionId/edit');
  const rulesDefinitionMatch = useMatch('/admin/file-definitions/:definitionId/rules');
  const versionsDefinitionMatch = useMatch('/admin/file-definitions/:definitionId/versions');
  const isDefinitionWorkspace = Boolean(newDefinitionMatch || editDefinitionMatch || rulesDefinitionMatch || versionsDefinitionMatch);
  const routeDefinitionId = editDefinitionMatch?.params.definitionId
    ?? rulesDefinitionMatch?.params.definitionId
    ?? versionsDefinitionMatch?.params.definitionId;

  return { newDefinitionMatch, rulesDefinitionMatch, versionsDefinitionMatch, isDefinitionWorkspace, routeDefinitionId };
}

export type DefinitionRoute = ReturnType<typeof useDefinitionRoute>;
