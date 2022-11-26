#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443
ARG VERSION=0

FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
WORKDIR /examples
ARG VERSION=0
COPY ["Demo.Mvc/Demo.Mvc.csproj", "Demo.Mvc/"]
RUN dotnet restore "Demo.Mvc/Demo.Mvc.csproj"
COPY . .
WORKDIR "/examples/Demo.Mvc"
RUN dotnet build "Demo.Mvc.csproj" -c Release /p:Version=${VERSION} -o /app/build

FROM build AS publish
ARG VERSION=0
RUN dotnet publish "Demo.Mvc.csproj" -c Release /p:Version=${VERSION} -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "Demo.Mvc.dll"]