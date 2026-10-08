export type CorporateActionType =
  | "STOCK_SPLIT"
  | "REVERSE_SPLIT"
  | "CASH_DIVIDEND"
  | "STOCK_DIVIDEND"
  | "RIGHTS_ISSUE"
  | "SPIN_OFF"
  | "MERGER"
  | "OTHER";

export interface CorporateActionInput {
  stockCode:
    string;

  actionType:
    CorporateActionType;

  effectiveDate:
    string;

  ratioFrom?:
    number | null;

  ratioTo?:
    number | null;

  cashAmount?:
    number | null;

  currency?:
    string | null;

  provider:
    string;

  providerEventId?:
    string | null;

  metadata?:
    Record<string, unknown>;

  isValidation?:
    boolean;
}

export interface CorporateActionProvider {
  providerName:
    string;

  providerVersion:
    string;

  fetchActions(
    stockCode:
      string,

    startDate:
      string,

    endDate:
      string,
  ): Promise<CorporateActionInput[]>;
}
