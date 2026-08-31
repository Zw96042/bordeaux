import type { PathProposal } from "../../shared/agent/types";

type ProposalContext = Pick<PathProposal, "baseSessionId" | "baseRevision" | "baseActivePathId" | "baseJavaCatalogFingerprint">;
interface PublishedContext {
  revision: number;
  project: object;
  activePathId: string;
  editRevision: number;
}
interface CurrentContext extends Omit<PublishedContext, "revision"> {
  javaCatalogFingerprint?: string | null;
  hasDraft: boolean;
}

/** An unpublished edit invalidates a proposal even before the next revision is sent. */
export function agentProposalMatchesPublishedContext(
  proposal: ProposalContext | null,
  sessionId: string,
  publishedContext: PublishedContext | null,
  currentContext: CurrentContext,
): boolean {
  return Boolean(proposal && publishedContext
    && proposal.baseSessionId === sessionId
    && proposal.baseRevision === publishedContext.revision
    && proposal.baseActivePathId === publishedContext.activePathId
    && publishedContext.project === currentContext.project
    && publishedContext.activePathId === currentContext.activePathId
    && publishedContext.editRevision === currentContext.editRevision
    && (!proposal.baseJavaCatalogFingerprint || proposal.baseJavaCatalogFingerprint === currentContext.javaCatalogFingerprint)
    && !currentContext.hasDraft);
}
