#!/usr/bin/env python3
"""Run the dashboard browser contract against a clean NuGet-only SQLite host."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--feed', type=Path, required=True, help='Directory containing locally packed candidate nupkgs')
parser.add_argument('--framework', choices=['net8.0', 'net10.0'], required=True)
parser.add_argument('--dotnet', default='dotnet')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
feed = args.feed.resolve()

# Obtain each version from the artifact itself; never impose one SDK-wide version.
packages = {}
for artifact in feed.glob('*.nupkg'):
    with zipfile.ZipFile(artifact) as archive:
        manifest = ET.fromstring(archive.read(next(name for name in archive.namelist() if name.endswith('.nuspec'))))
        metadata = next(element for element in manifest if element.tag.endswith('metadata'))
        values = {element.tag.split('}')[-1]: element.text for element in metadata}
        package_id = values['id']
        if package_id in packages:
            raise RuntimeError(f'Multiple candidate versions for {package_id}; use a clean feed')
        packages[package_id] = values['version']
for required in ['Toggly.FeatureManagement', 'Toggly.FeatureManagement.Catalog', 'Toggly.FeatureManagement.Embedded',
                 'Toggly.FeatureManagement.Dashboard', 'Toggly.FeatureManagement.Storage.EntityFramework']:
    if required not in packages:
        raise RuntimeError(f'Missing candidate package: {required}')

with tempfile.TemporaryDirectory(prefix='toggly-packed-consumer-') as temporary:
    host = Path(temporary)
    project = ET.Element('Project', Sdk='Microsoft.NET.Sdk.Web')
    properties = ET.SubElement(project, 'PropertyGroup')
    for name, value in {'TargetFramework': args.framework, 'Nullable': 'enable', 'ImplicitUsings': 'enable',
                        'RestorePackagesPath': str(host / 'packages')}.items():
        ET.SubElement(properties, name).text = value
    references = ET.SubElement(project, 'ItemGroup')
    for package_id in ['Toggly.FeatureManagement.Dashboard', 'Toggly.FeatureManagement.Storage.EntityFramework']:
        ET.SubElement(references, 'PackageReference', Include=package_id, Version=packages[package_id])
    ET.SubElement(references, 'PackageReference', Include='Microsoft.EntityFrameworkCore.Sqlite',
                  Version='8.0.0' if args.framework == 'net8.0' else '10.0.0')
    project_file = host / 'Consumer.csproj'
    ET.ElementTree(project).write(project_file, encoding='unicode')
    config = ET.Element('configuration')
    sources = ET.SubElement(config, 'packageSources')
    ET.SubElement(sources, 'clear')
    ET.SubElement(sources, 'add', key='candidate', value=str(feed))
    ET.SubElement(sources, 'add', key='nuget', value='https://api.nuget.org/v3/index.json')
    ET.ElementTree(config).write(host / 'NuGet.Config', encoding='unicode')
    shutil.copyfile(root / 'examples/Toggly.Examples.EmbeddedSqlite/Program.cs', host / 'Program.cs')
    env = dict(os.environ, TOGGLY_TEST_DOTNET=args.dotnet, TOGGLY_TEST_HOST_PROJECT=str(project_file))
    subprocess.run(['npm', '--prefix', str(root / 'Toggly.FeatureManagement.Dashboard.BrowserTests'),
                    'test', '--', '--reporter=line'], env=env, check=True)
