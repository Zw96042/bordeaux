import * as React from "react";
import { createPortal } from "react-dom";

const { useEffect, useRef, useState } = React;
const h = React.createElement;

function message(error) {
  return error && error.message ? error.message : String(error || 'The robot push failed');
}

function shortHash(value) {
  if (!value) return '—';
  return value.length > 24 ? value.slice(0, 19) + '…' + value.slice(-8) : value;
}
