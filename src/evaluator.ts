// Policy evaluation over parsed expressions.
// Semantics implemented here (not delegated to any library):
//   AND: all branches must pass. OR: at least one branch must pass.
//   License+exception is an independent combination: an allowed base
//   license never implies an unknown or unapproved exception is accepted.

import type { ExprNode } from './expression.js';

export interface PolicyRules {
  allowedLicenses: Set<string>;
  // keys of the form "LicenseID WITH ExceptionID"
  allowedCombos: Set<string>;
}

export interface EvalTrace {
  node: 'license' | 'and' | 'or';
  id?: string;
  exception?: string;
  status: 'pass' | 'fail';
  reason: string;
  branches?: EvalTrace[];
  // for OR: index of the branch that determined the outcome (first passing,
  // or last failing when all fail). Display order is stable left-to-right.
  decidedBy?: number;
}

export function evaluate(node: ExprNode, policy: PolicyRules): EvalTrace {
  if (node.type === 'license') {
    const licenseAllowed = policy.allowedLicenses.has(node.id);
    if (!node.exception) {
      return {
        node: 'license',
        id: node.id,
        status: licenseAllowed ? 'pass' : 'fail',
        reason: licenseAllowed
          ? `license '${node.id}' is allowed by policy`
          : `license '${node.id}' is not allowed by policy`,
      };
    }
    const comboKey = `${node.id} WITH ${node.exception}`;
    const comboAllowed = policy.allowedCombos.has(comboKey);
    return {
      node: 'license',
      id: node.id,
      exception: node.exception,
      status: comboAllowed ? 'pass' : 'fail',
      reason: comboAllowed
        ? `combination '${comboKey}' is allowed by policy`
        : `combination '${comboKey}' is not allowed by policy` +
          (licenseAllowed ? ` (base license '${node.id}' alone would be allowed, but the exception is not approved)` : ''),
    };
  }

  const left = evaluate(node.left, policy);
  const right = evaluate(node.right, policy);
  const branches = [left, right];

  if (node.type === 'and') {
    const pass = left.status === 'pass' && right.status === 'pass';
    return {
      node: 'and',
      status: pass ? 'pass' : 'fail',
      reason: pass ? 'AND: all branches satisfied' : 'AND: at least one branch rejected',
      branches,
    };
  }

  // OR: stable left-to-right order, first passing branch decides.
  const passIdx = branches.findIndex((b) => b.status === 'pass');
  const pass = passIdx !== -1;
  return {
    node: 'or',
    status: pass ? 'pass' : 'fail',
    reason: pass
      ? `OR: branch ${passIdx + 1} satisfied (evaluated left-to-right, first match)`
      : 'OR: no branch satisfied',
    branches,
    decidedBy: pass ? passIdx : branches.length - 1,
  };
}
