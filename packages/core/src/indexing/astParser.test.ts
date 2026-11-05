import { describe, it, expect } from 'vitest';
import { ASTCodeParser } from './astParser.js';

describe('ASTCodeParser', () => {
  const parser = new ASTCodeParser();

  it('parses TypeScript functions, classes, methods, imports, calls, and routes', () => {
    const tsCode = `
import { Router, Request, Response } from 'express';
import { queryDatabase } from './db';

export class OrderService {
  async processOrder(orderId: string): Promise<boolean> {
    const data = await queryDatabase(orderId);
    return Boolean(data);
  }
}

export function handleCheckout(id: string) {
  const service = new OrderService();
  return service.processOrder(id);
}

const router = Router();
router.post('/api/checkout', handleCheckout);
`;

    const intel = parser.parseSource('src/orders/checkout.ts', tsCode);

    expect(intel.language).toBe('typescript');
    expect(intel.symbols.length).toBeGreaterThanOrEqual(3);

    // Symbols
    const classSym = intel.symbols.find((s) => s.name === 'OrderService');
    expect(classSym).toBeDefined();
    expect(classSym!.kind).toBe('class');

    const methodSym = intel.symbols.find((s) => s.name === 'OrderService.processOrder');
    expect(methodSym).toBeDefined();
    expect(methodSym!.kind).toBe('method');
    expect(methodSym!.enclosingSymbol).toBe('OrderService');

    const funcSym = intel.symbols.find((s) => s.name === 'handleCheckout');
    expect(funcSym).toBeDefined();
    expect(funcSym!.kind).toBe('function');

    // Imports
    expect(intel.imports.length).toBeGreaterThanOrEqual(3);
    const dbImport = intel.imports.find((i) => i.importedSymbol === 'queryDatabase');
    expect(dbImport).toBeDefined();
    expect(dbImport!.sourceModule).toBe('./db');

    // Calls
    const queryCall = intel.calls.find((c) => c.calleeSymbol === 'queryDatabase');
    expect(queryCall).toBeDefined();
    expect(queryCall!.callerSymbol).toBe('OrderService.processOrder');

    // Route
    expect(intel.routes).toHaveLength(1);
    expect(intel.routes[0]!.method).toBe('POST');
    expect(intel.routes[0]!.path).toBe('/api/checkout');
  });

  it('parses Python functions, classes, imports, and FastAPI routes', () => {
    const pyCode = `
from fastapi import FastAPI, Depends
import math

app = FastAPI()

class PaymentProcessor:
    def execute_payment(self, amount: float):
        result = math.ceil(amount)
        return result

@app.get('/api/pay')
def pay_endpoint():
    processor = PaymentProcessor()
    return processor.execute_payment(100.5)
`;

    const intel = parser.parseSource('services/payment.py', pyCode);

    expect(intel.language).toBe('python');
    expect(intel.symbols.length).toBeGreaterThanOrEqual(2);

    const classSym = intel.symbols.find((s) => s.name === 'PaymentProcessor');
    expect(classSym).toBeDefined();

    const route = intel.routes.find((r) => r.path === '/api/pay');
    expect(route).toBeDefined();
    expect(route!.method).toBe('GET');

    const imp = intel.imports.find((i) => i.importedSymbol === 'FastAPI');
    expect(imp).toBeDefined();
    expect(imp!.sourceModule).toBe('fastapi');
  });

  it('parses Java classes, methods, imports, and Spring annotations', () => {
    const javaCode = `
package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

public class UserController {
    @GetMapping("/users")
    public String getUsers() {
        validateAccess();
        return "users";
    }
}
`;

    const intel = parser.parseSource('src/main/java/UserController.java', javaCode);

    expect(intel.language).toBe('java');
    const classSym = intel.symbols.find((s) => s.name === 'UserController');
    expect(classSym).toBeDefined();

    const methodSym = intel.symbols.find((s) => s.name === 'UserController.getUsers');
    expect(methodSym).toBeDefined();

    const route = intel.routes.find((r) => r.path === '/users');
    expect(route).toBeDefined();
    expect(route!.method).toBe('GET');

    const call = intel.calls.find((c) => c.calleeSymbol === 'validateAccess');
    expect(call).toBeDefined();
  });
});
