import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { type ToolContext } from '@/lib/tools/helpers/tool-context';

interface InstallPackagesInput {
  packages: string[];
  dev?: boolean;
  exact?: boolean;
  global?: boolean;
}

interface InstallResult {
  success: boolean;
  packages: string[];
  installed: string[];
  failed: string[];
  output: string;
  error?: string;
  package_json_updated?: boolean;
}

export default async function install_packages(input: InstallPackagesInput, context: ToolContext): Promise<InstallResult> {
  const { packages, dev = false, exact = false, global: isGlobal = false } = input;

  if (!packages || packages.length === 0) {
    return {
      success: false,
      packages: [],
      installed: [],
      failed: [],
      output: '',
      error: 'No packages specified'
    };
  }

  // Build npm install command
  const args = ['install'];
  
  if (isGlobal) {
    args.push('-g');
  } else {
    if (dev) {
      args.push('--save-dev');
    }
    if (exact) {
      args.push('--save-exact');
    }
  }
  
  args.push(...packages);

  return new Promise<InstallResult>((resolve) => {
    let output = '';
    let errorOutput = '';

    const npmProcess = spawn('npm', args, {
      cwd: process.cwd(),
      shell: true
    });

    npmProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    npmProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    npmProcess.on('close', (code) => {
      const fullOutput = output + errorOutput;
      
      if (code === 0) {
        // Installation successful
        const installed: string[] = [];
        const failed: string[] = [];

        // Verify each package was installed
        for (const pkg of packages) {
          const pkgName = pkg.split('@')[0]; // Handle versioned packages like 'express@4.18.0'
          const nodeModulesPath = path.join(process.cwd(), 'node_modules', pkgName);
          
          if (fs.existsSync(nodeModulesPath)) {
            installed.push(pkg);
          } else {
            failed.push(pkg);
          }
        }

        // Check if package.json was updated (for non-global installs)
        let packageJsonUpdated = false;
        if (!isGlobal) {
          const packageJsonPath = path.join(process.cwd(), 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            packageJsonUpdated = true;
          }
        }

        resolve({
          success: true,
          packages,
          installed,
          failed,
          output: fullOutput,
          package_json_updated: packageJsonUpdated
        });
      } else {
        // Installation failed
        resolve({
          success: false,
          packages,
          installed: [],
          failed: packages,
          output: fullOutput,
          error: `npm install failed with code ${code}: ${errorOutput}`
        });
      }
    });

    npmProcess.on('error', (err) => {
      resolve({
        success: false,
        packages,
        installed: [],
        failed: packages,
        output: '',
        error: `Failed to spawn npm process: ${err.message}`
      });
    });
  });
}