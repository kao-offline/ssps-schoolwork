import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config({ignores:['dist/**','node_modules/**']},js.configs.recommended,...ts.configs.recommended,{files:['**/*.ts'],rules:{'@typescript-eslint/no-explicit-any':'off'}},{files:['browser/**/*.js'],languageOptions:{globals:{chrome:'readonly',document:'readonly',window:'readonly',location:'readonly',URL:'readonly',Blob:'readonly'}}});
