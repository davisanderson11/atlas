// Math equation detection and solving handler module

export class MathHandler {
  constructor(ai) {
    this.ai = ai;
  }

  /**
   * Check if text is a math equation
   */
  isMathEquation(text) {
    const trimmed = text.trim();
    
    // Common math patterns
    const mathPatterns = [
      /^[\d\s\+\-\*\/\^\(\)\.]+\s*=\s*[\d\s\+\-\*\/\^\(\)\.x]*$/, // Basic equation with =
      /^[\d\s\+\-\*\/\^\(\)\.]+$/, // Just an expression to evaluate
      /^[\d\s\+\-\*\/\^\(\)\.x]+\s*=\s*[\d\s\+\-\*\/\^\(\)\.x]+$/, // Equation with variable
      /\b(sin|cos|tan|log|ln|sqrt|exp)\b/i, // Trig/log functions
      /\b[a-zA-Z]\s*\(\s*x\s*\)\s*=/, // Function notation f(x) = ...
      /\by\s*=\s*[^=]+/, // y = ... equations
      /x\^\d+|\d+x/, // Polynomial terms
      /\^[\d\(\)]+/, // Exponents
      /\b(solve|find|calculate)\b.*\b(for|equation)\b/i, // Word problems
    ];
    
    // Check if it matches any math pattern
    const isMath = mathPatterns.some(pattern => pattern.test(trimmed));
    
    // Additional checks
    const hasNumbers = /\d/.test(trimmed);
    const hasVariables = /\b[xyzabc]\b/.test(trimmed);
    const hasOperators = /[\+\-\*\/\^=]/.test(trimmed);
    const notTooLong = trimmed.length < 200; // Math expressions are usually concise
    
    // Check for function-like patterns even without explicit patterns
    const looksLikeFunction = hasVariables && (hasOperators || /\(.*\)/.test(trimmed));
    
    return isMath || (notTooLong && ((hasNumbers && hasOperators) || looksLikeFunction));
  }

  /**
   * Parse and analyze math equation
   */
  parseMathEquation(text) {
    const trimmed = text.trim();
    
    // Determine equation type
    let type = 'expression';
    let equation = trimmed;
    let variable = null;
    let graphableFunction = null;
    
    if (trimmed.includes('=')) {
      type = 'equation';
      // Check if it has variables
      if (/[a-zA-Z]/.test(trimmed)) {
        type = 'algebraic';
        // Find the variable (usually x, y, or z)
        const varMatch = trimmed.match(/[xyz]/i);
        variable = varMatch ? varMatch[0].toLowerCase() : 'x';
        
        // Try to extract a graphable function
        graphableFunction = this.extractGraphableFunction(trimmed);
      }
    }
    
    return {
      original: trimmed,
      type: type,
      variable: variable,
      equation: equation,
      graphableFunction: graphableFunction,
      needsAISolving: true
    };
  }

  /**
   * Extract a graphable function from an equation
   */
  extractGraphableFunction(equation) {
    // Clean the equation first
    const cleaned = equation.trim();
    
    // Try to parse equations like "y = x^2 + 2x - 3"
    const yEqualsMatch = cleaned.match(/y\s*=\s*(.+)/i);
    if (yEqualsMatch) {
      return this.convertToJSFunction(yEqualsMatch[1].trim());
    }
    
    // Try to parse functions like "f(x) = x^2 + 2x - 3" or "g(x) = ..."
    const fxMatch = cleaned.match(/[a-zA-Z]\s*\(\s*x\s*\)\s*=\s*(.+)/i);
    if (fxMatch) {
      return this.convertToJSFunction(fxMatch[1].trim());
    }
    
    // Try to parse implicit functions like "x^2 + 2x - 3" or "sin(x)"
    if (cleaned.includes('x') && !cleaned.includes('=')) {
      // Make sure it's not a solve-for-x type problem
      if (!cleaned.match(/\b(solve|find|calculate)\b/i)) {
        return this.convertToJSFunction(cleaned);
      }
    }
    
    // Try to extract from common patterns like "The function f(x) = x^2"
    const functionMatch = cleaned.match(/function[^=]*=\s*(.+)/i);
    if (functionMatch) {
      const func = functionMatch[1].trim();
      if (func.includes('x')) {
        return this.convertToJSFunction(func);
      }
    }
    
    return null;
  }

  /**
   * Convert math notation to JavaScript function
   */
  convertToJSFunction(expr) {
    try {
      // Clean up the expression
      let jsExpr = expr
        .replace(/\s+/g, ' ')
        .trim();
      
      // Handle implicit multiplication more carefully
      // Replace x^n with x**n
      jsExpr = jsExpr.replace(/\^/g, '**');
      
      // Handle coefficients before variables (2x -> 2*x)
      jsExpr = jsExpr.replace(/(\d+)([a-zA-Z])/g, '$1*$2');
      
      // Replace math functions FIRST - before handling implicit multiplication
      jsExpr = jsExpr.replace(/\bsin\b/g, 'Math.sin');
      jsExpr = jsExpr.replace(/\bcos\b/g, 'Math.cos');
      jsExpr = jsExpr.replace(/\btan\b/g, 'Math.tan');
      jsExpr = jsExpr.replace(/\bln\b/g, 'Math.log');
      jsExpr = jsExpr.replace(/\blog\b/g, 'Math.log10');
      jsExpr = jsExpr.replace(/\bsqrt\b/g, 'Math.sqrt');
      jsExpr = jsExpr.replace(/\babs\b/g, 'Math.abs');
      jsExpr = jsExpr.replace(/\bpi\b/gi, 'Math.PI');
      jsExpr = jsExpr.replace(/\be\b/g, 'Math.E');
      
      // Now handle implicit multiplication
      // Handle variables before parentheses (x(2) -> x*(2)) but NOT for Math functions
      // First protect Math functions
      jsExpr = jsExpr.replace(/Math\.(sin|cos|tan|log|log10|sqrt|abs)\(/g, '__MATH_$1__(');
      
      // Now do the variable multiplication
      jsExpr = jsExpr.replace(/([a-zA-Z])\s*\(/g, '$1*(');
      
      // Restore Math functions
      jsExpr = jsExpr.replace(/__MATH_(\w+)__\(/g, 'Math.$1(');
      
      // Handle numbers before parentheses (2(x) -> 2*(x))
      jsExpr = jsExpr.replace(/(\d+)\s*\(/g, '$1*(');
      
      // Handle parentheses multiplication )(  -> )*(
      jsExpr = jsExpr.replace(/\)\s*\(/g, ')*(');
      
      // Handle parentheses before variables )x -> )*x
      jsExpr = jsExpr.replace(/\)\s*([a-zA-Z])/g, ')*$1');
      
      // Handle parentheses before numbers )2 -> )*2
      jsExpr = jsExpr.replace(/\)\s*(\d)/g, ')*$1');
      
      // Test if it's a valid function
      const testFunc = new Function('x', `return ${jsExpr}`);
      // Test with a few values to ensure it works
      testFunc(0);
      testFunc(1);
      testFunc(-1);
      
      return jsExpr;
    } catch (e) {
      console.error('Failed to convert expression:', e);
      return null;
    }
  }

  /**
   * Process math equation
   */
  async process(text) {
    const mathData = this.parseMathEquation(text);
    
    const mathPrompt = `Solve this math problem step-by-step. Show your work clearly:

${text}

Please:
1. Identify what type of problem this is
2. Show each step of the solution
3. Explain what you're doing in each step
4. Give the final answer clearly
5. If it's a function of x, describe its properties (domain, range, intercepts, etc.)
6. Use LaTeX notation for mathematical expressions (e.g., $x^2$, $\\frac{a}{b}$, $\\boxed{answer}$)
7. Use bullet points where appropriate

Do NOT include any special formatting like "GRAPH_FUNCTION:" - just solve and explain the problem.`;

    console.log('[MathHandler] Processing equation:', text);
    
    try {
      const result = await this.ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: mathPrompt
      });
      
      const solution = result.text.trim();
      
      // Return both the solution and any graphable function if found
      return {
        type: 'math',
        solution: solution,
        graphableFunction: mathData.graphableFunction,
        original: text
      };
    } catch (error) {
      console.error('[MathHandler] AI error:', error);
      throw error;
    }
  }
}