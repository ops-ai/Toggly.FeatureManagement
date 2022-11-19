#See https://aka.ms/containerfastmode to understand how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS base
WORKDIR /app
EXPOSE 80
EXPOSE 443
ARG VERSION=0

FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
ARG VERSION=0
WORKDIR /src
COPY ["examples/Toggly.Examples.Mvc/Toggly.Examples.Mvc.csproj", "examples/Toggly.Examples.Mvc/"]
RUN dotnet restore "examples/Toggly.Examples.Mvc/Toggly.Examples.Mvc.csproj"
COPY . .
WORKDIR "/src/examples/Toggly.Examples.Mvc"
RUN dotnet build "Toggly.Examples.Mvc.csproj" -c Release /p:Version=${VERSION} -o /app/build

FROM build AS publish
ARG VERSION=0
RUN dotnet publish "Toggly.Examples.Mvc.csproj" -c Release /p:Version=${VERSION} -o /app/publish

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "Toggly.Examples.Mvc.dll"]